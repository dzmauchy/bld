// Browser runtime adapter for the base library HAL.
export const browserHost = String.raw`#pragma once

#include <core/hal.hpp>
#include <core/math.hpp>


extern "C" void mount();


#ifndef BLD_WASM_HOST_IMPL
#define BLD_WASM_HOST_IMPL

namespace {

constexpr u32 kCap = 64;
constexpr u32 kMaxPins = 8;

void invoke(core::function<void()>* callback) {
  if (callback) {
    (*callback)();
  }
}

class WasmHost {
 public:
  static WasmHost instanceHost;
  static WasmHost& instance() { return instanceHost; }

  void onStart(core::function<void()>* callback) { pushCallback(start_, startCount_, callback); }
  void onClose(core::function<void()>* callback) { pushCallback(close_, closeCount_, callback); }
  void onStop(core::function<void()>* callback) { pushCallback(stop_, stopCount_, callback); }

  u32 setInterval(u32 milliseconds, core::function<void()>* callback) {
    if (intervalCount_ >= kCap) {
      return 0;
    }
    const u32 id = nextIntervalId_++;
    intervals_[intervalCount_++] = Interval{id, milliseconds, callback, true};
    return id;
  }

  void clearInterval(u32 intervalId) {
    for (u32 i = 0; i < intervalCount_; ++i) {
      if (intervals_[i].id == intervalId) {
        intervals_[i].active = false;
      }
    }
  }

  bool readGpio(u32 port, u8 pin) const {
    for (u32 i = 0; i < kCap; ++i) {
      if (gpioValues_[i].used && gpioValues_[i].port == port && gpioValues_[i].pin == pin) {
        return gpioValues_[i].value;
      }
    }
    return false;
  }

  u32 setGpio(u32 port, u8 pin, core::function<void()>* callback) {
    if (gpioCount_ >= kCap) {
      return 0;
    }
    const u32 id = nextGpioId_++;
    gpio_[gpioCount_++] = GpioListener{id, port, pin, callback, true};
    return id;
  }

  void clearGpio(u32 gpioId) {
    for (u32 i = 0; i < gpioCount_; ++i) {
      if (gpio_[i].id == gpioId) {
        gpio_[i].active = false;
      }
    }
  }

  void sendGpio(u32 port, u8 pin, bool value) {
    setGpioValue(port, pin, value);
    fireGpio(port, pin);
  }

  void sendF32(u32 blockId, u8 inputId, f32 value) {
    setF32(blockId, inputId, value);
    ++pinWriteCount_;
  }

  void sendF64(u32 blockId, u8 inputId, f64 value) { setF64(blockId, inputId, value); ++pinWriteCount_; }

  f32 randomF32() const { return random_; }
  f64 randomF64() const { return static_cast<f64>(random_); }
  u64 now() const { return now_; }

  void start() {
    if (!built_) {
      built_ = true;
      mount();
    }
    if (started_) {
      return;
    }
    started_ = true;
    const u32 count = startCount_;
    for (u32 i = 0; i < count; ++i) {
      invoke(start_[i]);
    }
  }

  void close() {
    const u32 count = closeCount_;
    for (u32 i = 0; i < count; ++i) {
      invoke(close_[i]);
    }
  }

  void tick() {
    const u32 count = intervalCount_;
    for (u32 i = 0; i < count; ++i) {
      if (intervals_[i].active) {
        invoke(intervals_[i].callback);
      }
    }
  }

  void setNow(u64 milliseconds) { now_ = milliseconds; }
  void setRandom(f32 value) { random_ = value; }

  void emitGpioIn(u32 blockId, u32 pinIndex, bool value) {
    for (u32 i = 0; i < gpioBlockCount_; ++i) {
      const GpioBlock& block = gpioBlocks_[i];
      if (block.blockId == blockId && pinIndex < block.pinCount) {
        sendGpio(block.port, block.pins[pinIndex], value);
        return;
      }
    }
  }

  void registerGpioBlock(u32 blockId, u16 port, const core::array<u8>& pins) {
    if (gpioBlockCount_ >= kCap) {
      return;
    }
    GpioBlock& block = gpioBlocks_[gpioBlockCount_++];
    block.blockId = blockId;
    block.port = port;
    block.pinCount = pins.size() < kMaxPins ? static_cast<u8>(pins.size()) : static_cast<u8>(kMaxPins);
    for (u8 i = 0; i < block.pinCount; ++i) {
      block.pins[i] = pins[i];
    }
  }

  bool hasF32(u32 blockId, u8 channel) const {
    for (u32 i = 0; i < kCap; ++i) {
      if (valuesF32_[i].used && valuesF32_[i].blockId == blockId && valuesF32_[i].channel == channel) {
        return true;
      }
    }
    return false;
  }

  f32 lastF32(u32 blockId, u8 channel) const {
    for (u32 i = 0; i < kCap; ++i) {
      if (valuesF32_[i].used && valuesF32_[i].blockId == blockId && valuesF32_[i].channel == channel) {
        return valuesF32_[i].value;
      }
    }
    return core::quiet_nan<f32>();
  }

  bool hasF64(u32 blockId, u8 channel) const {
    for (const auto& value : valuesF64_) {
      if (value.used && value.blockId == blockId && value.channel == channel) return true;
    }
    return false;
  }

  f64 lastF64(u32 blockId, u8 channel) const {
    for (const auto& value : valuesF64_) {
      if (value.used && value.blockId == blockId && value.channel == channel) return value.value;
    }
    return core::quiet_nan<f64>();
  }

  u32 activeIntervalCount() const {
    u32 count = 0;
    for (u32 i = 0; i < intervalCount_; ++i) {
      if (intervals_[i].active) {
        ++count;
      }
    }
    return count;
  }

  u32 activeGpioCount() const {
    u32 count = 0;
    for (u32 i = 0; i < gpioCount_; ++i) {
      if (gpio_[i].active) {
        ++count;
      }
    }
    return count;
  }

  u32 intervalPeriodAt(u32 index) const {
    u32 seen = 0;
    for (u32 i = 0; i < intervalCount_; ++i) {
      if (!intervals_[i].active) {
        continue;
      }
      if (seen == index) {
        return intervals_[i].period;
      }
      ++seen;
    }
    return 0;
  }

  u32 pinWriteCount() const { return pinWriteCount_; }

  void clearPins() {
    for (u32 i = 0; i < kCap; ++i) {
      valuesF32_[i].used = false;
      valuesF64_[i].used = false;
    }
    pinWriteCount_ = 0;
  }

 private:
  struct Interval {
    u32 id;
    u32 period;
    core::function<void()>* callback;
    bool active;
  };

  struct GpioListener {
    u32 id;
    u32 port;
    u8 pin;
    core::function<void()>* callback;
    bool active;
  };

  struct GpioBlock {
    u32 blockId;
    u16 port;
    u8 pinCount;
    u8 pins[kMaxPins];
  };

  struct GpioValue {
    u32 port;
    u8 pin;
    bool value;
    bool used;
  };

  struct F32Value {
    u32 blockId;
    u8 channel;
    f32 value;
    bool used;
  };

  struct F64Value {
    u32 blockId;
    u8 channel;
    f64 value;
    bool used;
  };

  static void pushCallback(core::function<void()>** list, u32& count, core::function<void()>* callback) {
    if (count < kCap) {
      list[count++] = callback;
    }
  }

  void setGpioValue(u32 port, u8 pin, bool value) {
    for (u32 i = 0; i < kCap; ++i) {
      if (gpioValues_[i].used && gpioValues_[i].port == port && gpioValues_[i].pin == pin) {
        gpioValues_[i].value = value;
        return;
      }
    }
    for (u32 i = 0; i < kCap; ++i) {
      if (!gpioValues_[i].used) {
        gpioValues_[i] = GpioValue{port, pin, value, true};
        return;
      }
    }
  }

  void setF32(u32 blockId, u8 channel, f32 value) {
    for (u32 i = 0; i < kCap; ++i) {
      if (valuesF32_[i].used && valuesF32_[i].blockId == blockId && valuesF32_[i].channel == channel) {
        valuesF32_[i].value = value;
        return;
      }
    }
    for (u32 i = 0; i < kCap; ++i) {
      if (!valuesF32_[i].used) {
        valuesF32_[i] = F32Value{blockId, channel, value, true};
        return;
      }
    }
  }

  void setF64(u32 blockId, u8 channel, f64 value) {
    for (u32 i = 0; i < kCap; ++i) {
      if (valuesF64_[i].used && valuesF64_[i].blockId == blockId && valuesF64_[i].channel == channel) {
        valuesF64_[i].value = value;
        return;
      }
    }
    for (u32 i = 0; i < kCap; ++i) {
      if (!valuesF64_[i].used) {
        valuesF64_[i] = F64Value{blockId, channel, value, true};
        return;
      }
    }
  }

  void fireGpio(u32 port, u8 pin) {
    const u32 count = gpioCount_;
    for (u32 i = 0; i < count; ++i) {
      const GpioListener& listener = gpio_[i];
      if (listener.active && listener.port == port && listener.pin == pin) {
        invoke(listener.callback);
      }
    }
  }

  core::function<void()>* start_[kCap]{};
  u32 startCount_{0};
  core::function<void()>* close_[kCap]{};
  u32 closeCount_{0};
  core::function<void()>* stop_[kCap]{};
  u32 stopCount_{0};
  Interval intervals_[kCap]{};
  u32 intervalCount_{0};
  GpioListener gpio_[kCap]{};
  u32 gpioCount_{0};
  GpioBlock gpioBlocks_[kCap]{};
  u32 gpioBlockCount_{0};
  GpioValue gpioValues_[kCap]{};
  F32Value valuesF32_[kCap]{};
  F64Value valuesF64_[kCap]{};
  u32 nextIntervalId_{1};
  u32 nextGpioId_{1};
  u32 pinWriteCount_{0};
  u64 now_{0};
  f32 random_{0};
  bool built_{false};
  bool started_{false};
};

WasmHost WasmHost::instanceHost{};

}  // namespace

void register_gpio_block(u32 blockId, u16 port, const core::array<u8>& pins) {
  WasmHost::instance().registerGpioBlock(blockId, port, pins);
}

extern "C" {

void on_close(core::function<void()>* cbk) { WasmHost::instance().onClose(cbk); }
void on_start(core::function<void()>* cbk) { WasmHost::instance().onStart(cbk); }
void on_stop(core::function<void()>* cbk) { WasmHost::instance().onStop(cbk); }

u32 set_interval(u32 milliseconds, core::function<void()>* cbk) { return WasmHost::instance().setInterval(milliseconds, cbk); }
void clear_interval(u32 intervalId) { WasmHost::instance().clearInterval(intervalId); }

bool read_gpio(u32 port, u8 pin) { return WasmHost::instance().readGpio(port, pin); }
u32 set_gpio(u32 port, u8 pin, core::function<void()>* cbk) { return WasmHost::instance().setGpio(port, pin, cbk); }
void clear_gpio(u32 gpio_id) { WasmHost::instance().clearGpio(gpio_id); }
void send_gpio(u32 port, u8 pin, bool value) { WasmHost::instance().sendGpio(port, pin, value); }

f32 read_adc_f32(u32, u8) { return 0; }
f64 read_adc_f64(u32, u8) { return 0; }
void send_dac_f32(u32, u8, f32) {}
void send_dac_f64(u32, u8, f64) {}

__attribute__((import_module("env"), import_name("host_sendPinF32")))
void host_sendPinF32(u32 blockId, u8 pin, f32 value);

void send_value_f32(u32 blockId, u8 inputId, f32 value) {
  WasmHost::instance().sendF32(blockId, inputId, value);
  host_sendPinF32(blockId, inputId, value);
}
__attribute__((import_module("env"), import_name("host_sendPinF64")))
void host_sendPinF64(u32 blockId, u8 pin, f64 value);
void send_value_f64(u32 blockId, u8 inputId, f64 value) {
  WasmHost::instance().sendF64(blockId, inputId, value);
  host_sendPinF64(blockId, inputId, value);
}

f32 random_f32() { return WasmHost::instance().randomF32(); }
f64 random_f64() { return WasmHost::instance().randomF64(); }

u64 get_time() { return WasmHost::instance().now(); }

void start() { WasmHost::instance().start(); }
void tick() { WasmHost::instance().tick(); }
void tickThenObserve() { WasmHost::instance().tick(); }
void close() { WasmHost::instance().close(); }
void setNow(u32 ms) { WasmHost::instance().setNow(ms); }
void setRandom(f32 value) { WasmHost::instance().setRandom(value); }
void emitGpio(u32 port, u32 pin, u32 value) { WasmHost::instance().sendGpio(port, static_cast<u8>(pin), value != 0); }
void emitGpioIn(u32 blockId, u32 pinIndex, u32 value) { WasmHost::instance().emitGpioIn(blockId, pinIndex, value != 0); }
f64 lastPin(u32 blockId, u32 pin) {
  auto& host = WasmHost::instance();
  auto channel = static_cast<u8>(pin);
  return host.hasF64(blockId, channel) ? host.lastF64(blockId, channel) : host.lastF32(blockId, channel);
}
u32 hasPin(u32 blockId, u32 pin) { return (WasmHost::instance().hasF32(blockId, static_cast<u8>(pin)) || WasmHost::instance().hasF64(blockId, static_cast<u8>(pin))) ? 1 : 0; }
u32 pinWriteCount() { return WasmHost::instance().pinWriteCount(); }
u32 activeIntervalCount() { return WasmHost::instance().activeIntervalCount(); }
u32 intervalPeriodAt(u32 index) { return WasmHost::instance().intervalPeriodAt(index); }
u32 activeGpioListenerCount() { return WasmHost::instance().activeGpioCount(); }
void clearPins() { WasmHost::instance().clearPins(); }
}

#endif
`;
