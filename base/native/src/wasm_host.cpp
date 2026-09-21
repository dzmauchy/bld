#include "wasm_host.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <ranges>
#include <utility>
#include <vector>

namespace {

constexpr auto invoke = [](auto* callback) {
  if (callback) {
    (*callback)();
  }
};

constexpr auto isActive = [](const auto& item) { return item.active; };

class WasmHost {
 public:
  static auto& instance() {
    static auto host = WasmHost{};
    return host;
  }

  void reset() { *this = WasmHost(); }

  void handleOnStart(Callback* callback) { start_.push_back(callback); }
  void handleOnClose(Callback* callback) { close_.push_back(callback); }
  void handleOnStop(Callback* callback) { stop_.push_back(callback); }

  auto handleSetInterval(u32 milliseconds, Callback* callback) -> u32 {
    auto id = nextIntervalId_++;
    intervals_.push_back({.id = id, .period = milliseconds, .callback = callback, .active = true});
    return id;
  }

  void handleClearInterval(u32 intervalId) {
    std::ranges::for_each(intervals_, [intervalId](auto& interval) {
      if (interval.id == intervalId) {
        interval.active = false;
      }
    });
  }

  auto handleReadGpio(u32 port, u8 pin) const -> bool {
    if (auto it = gpioValues_.find({port, pin}); it != gpioValues_.end()) {
      return it->second;
    }
    return false;
  }

  auto handleSetGpio(u32 port, u8 pin, Callback* callback) -> u32 {
    auto id = nextGpioId_++;
    gpio_.push_back({.id = id, .port = port, .pin = pin, .callback = callback, .active = true});
    return id;
  }

  void handleClearGpio(u32 gpioId) {
    std::ranges::for_each(gpio_, [gpioId](auto& listener) {
      if (listener.id == gpioId) {
        listener.active = false;
      }
    });
  }

  void handleSendGpio(u32 port, u8 pin, bool value) {
    gpioValues_[{port, pin}] = value;
    fireGpio(port, pin);
  }

  void handleSendF32(u32 blockId, u8 inputId, f32 value) {
    valuesF32_[{blockId, inputId}] = value;
    ++pinWriteCount_;
  }

  void handleSendF64(u32 blockId, u8 inputId, f64 value) { valuesF64_[{blockId, inputId}] = value; }

  auto handleRandomF32() const -> f32 { return random_; }
  auto handleRandomF64() const -> f64 { return static_cast<f64>(random_); }
  auto handleGetTime() const -> u64 { return now_; }

  void start() {
    if (!built_) {
      built_ = true;
      build_diagram();
    }
    if (started_) return;
    started_ = true;
    auto callbacks = start_;
    std::ranges::for_each(callbacks, invoke);
  }

  void close() {
    auto callbacks = close_;
    std::ranges::for_each(callbacks, invoke);
  }

  void tick() {
    auto intervals = intervals_;
    for (const auto& interval : intervals | std::views::filter(isActive)) {
      invoke(interval.callback);
    }
  }

  void setNow(u64 milliseconds) { now_ = milliseconds; }
  void setRandom(f32 value) { random_ = value; }

  void emitGpio(u32 port, u8 pin, bool value) { handleSendGpio(port, pin, value); }

  void emitGpioIn(u32 blockId, u32 pinIndex, bool value) {
    for (const auto& block : gpioBlocks_) {
      if (block.blockId == blockId && pinIndex < block.pins.size()) {
        handleSendGpio(block.port, block.pins[pinIndex], value);
        return;
      }
    }
  }

  void registerGpioBlock(u32 blockId, u16 port, std::vector<u8> pins) {
    gpioBlocks_.push_back({blockId, port, std::move(pins)});
  }

  auto hasF32(u32 blockId, u8 channel) const -> bool { return valuesF32_.contains({blockId, channel}); }

  auto lastF32(u32 blockId, u8 channel) const -> f32 {
    if (auto it = valuesF32_.find({blockId, channel}); it != valuesF32_.end()) {
      return it->second;
    }
    return std::numeric_limits<f32>::quiet_NaN();
  }

  auto activeIntervalCount() const -> u32 { return static_cast<u32>(std::ranges::count_if(intervals_, isActive)); }
  auto activeGpioCount() const -> u32 { return static_cast<u32>(std::ranges::count_if(gpio_, isActive)); }

  auto intervalPeriodAt(u32 index) const -> u32 {
    auto active = intervals_ | std::views::filter(isActive) | std::views::drop(index);
    if (auto it = std::ranges::begin(active); it != std::ranges::end(active)) {
      return it->period;
    }
    return 0;
  }

  auto pinWriteCount() const -> u32 { return pinWriteCount_; }

  void clearPins() {
    valuesF32_.clear();
    valuesF64_.clear();
    pinWriteCount_ = 0;
  }

 private:
  struct Interval {
    u32 id;
    u32 period;
    Callback* callback;
    bool active;
  };

  struct GpioListener {
    u32 id;
    u32 port;
    u8 pin;
    Callback* callback;
    bool active;
  };

  struct GpioBlock {
    u32 blockId;
    u16 port;
    std::vector<u8> pins;
  };

  void fireGpio(u32 port, u8 pin) {
    auto listeners = gpio_;
    for (const auto& listener : listeners | std::views::filter(isActive)) {
      if (listener.port == port && listener.pin == pin) {
        invoke(listener.callback);
      }
    }
  }

  std::vector<Callback*> start_{};
  std::vector<Callback*> close_{};
  std::vector<Callback*> stop_{};
  std::vector<Interval> intervals_{};
  std::vector<GpioListener> gpio_{};
  std::vector<GpioBlock> gpioBlocks_{};
  std::map<std::pair<u32, u8>, bool> gpioValues_{};
  std::map<std::pair<u32, u8>, f32> valuesF32_{};
  std::map<std::pair<u32, u8>, f64> valuesF64_{};
  u32 nextIntervalId_{1};
  u32 nextGpioId_{1};
  u32 pinWriteCount_{0};
  u64 now_{0};
  f32 random_{0};
  bool built_{false};
  bool started_{false};
};

}  // namespace

void register_gpio_block(u32 blockId, u16 port, std::vector<u8> pins) {
  WasmHost::instance().registerGpioBlock(blockId, port, std::move(pins));
}

extern "C" {

void on_close(Callback* cbk) { WasmHost::instance().handleOnClose(cbk); }
void on_start(Callback* cbk) { WasmHost::instance().handleOnStart(cbk); }
void on_stop(Callback* cbk) { WasmHost::instance().handleOnStop(cbk); }

u32 set_interval(u32 milliseconds, Callback* cbk) { return WasmHost::instance().handleSetInterval(milliseconds, cbk); }
void clear_interval(u32 intervalId) { WasmHost::instance().handleClearInterval(intervalId); }

bool read_gpio(u32 port, u8 pin) { return WasmHost::instance().handleReadGpio(port, pin); }
u32 set_gpio(u32 port, u8 pin, Callback* cbk) { return WasmHost::instance().handleSetGpio(port, pin, cbk); }
void clear_gpio(u32 gpio_id) { WasmHost::instance().handleClearGpio(gpio_id); }
void send_gpio(u32 port, u8 pin, bool value) { WasmHost::instance().handleSendGpio(port, pin, value); }

f32 read_adc_f32(u32, u8) { return 0; }
f64 read_adc_f64(u32, u8) { return 0; }
void send_dac_f32(u32, u8, f32) {}
void send_dac_f64(u32, u8, f64) {}

void host_sendPinF32(u32 blockId, u8 pin, f32 value);

void send_value_f32(u32 blockId, u8 inputId, f32 value) {
  WasmHost::instance().handleSendF32(blockId, inputId, value);
  host_sendPinF32(blockId, inputId, value);
}
void send_value_f64(u32 blockId, u8 inputId, f64 value) { WasmHost::instance().handleSendF64(blockId, inputId, value); }

f32 random_f32() { return WasmHost::instance().handleRandomF32(); }
f64 random_f64() { return WasmHost::instance().handleRandomF64(); }

u64 get_time() { return WasmHost::instance().handleGetTime(); }

f32 sin_f32(f32 value) { return std::sin(value); }
f64 sin_f64(f64 value) { return std::sin(value); }
f32 cos_f32(f32 value) { return std::cos(value); }
f64 cos_f64(f64 value) { return std::cos(value); }
f32 tan_f32(f32 value) { return std::tan(value); }
f64 tan_f64(f64 value) { return std::tan(value); }
f32 asin_f32(f32 value) { return std::asin(value); }
f64 asin_f64(f64 value) { return std::asin(value); }
f32 acos_f32(f32 value) { return std::acos(value); }
f64 acos_f64(f64 value) { return std::acos(value); }
f32 atan_f32(f32 value) { return std::atan(value); }
f64 atan_f64(f64 value) { return std::atan(value); }
f32 exp_f32(f32 value) { return std::exp(value); }
f64 exp_f64(f64 value) { return std::exp(value); }
f32 log_f32(f32 value) { return std::log(value); }
f64 log_f64(f64 value) { return std::log(value); }
f32 log10_f32(f32 value) { return std::log10(value); }
f64 log10_f64(f64 value) { return std::log10(value); }
f32 pow_f32(f32 base, f32 exponent) { return std::pow(base, exponent); }
f64 pow_f64(f64 base, f64 exponent) { return std::pow(base, exponent); }
f32 sqrt_f32(f32 value) { return std::sqrt(value); }
f64 sqrt_f64(f64 value) { return std::sqrt(value); }
f32 ceil_f32(f32 value) { return std::ceil(value); }
f64 ceil_f64(f64 value) { return std::ceil(value); }
f32 floor_f32(f32 value) { return std::floor(value); }
f64 floor_f64(f64 value) { return std::floor(value); }

void start() { WasmHost::instance().start(); }
void tick() { WasmHost::instance().tick(); }
void tickThenObserve() { WasmHost::instance().tick(); }
void close() { WasmHost::instance().close(); }
void setNow(u32 ms) { WasmHost::instance().setNow(ms); }
void setRandom(f32 value) { WasmHost::instance().setRandom(value); }
void emitGpio(u32 port, u32 pin, u32 value) { WasmHost::instance().emitGpio(port, static_cast<u8>(pin), value != 0); }
void emitGpioIn(u32 blockId, u32 pinIndex, u32 value) { WasmHost::instance().emitGpioIn(blockId, pinIndex, value != 0); }
f32 lastPin(u32 blockId, u32 pin) { return WasmHost::instance().lastF32(blockId, static_cast<u8>(pin)); }
u32 hasPin(u32 blockId, u32 pin) { return WasmHost::instance().hasF32(blockId, static_cast<u8>(pin)) ? 1 : 0; }
u32 pinWriteCount() { return WasmHost::instance().pinWriteCount(); }
u32 activeIntervalCount() { return WasmHost::instance().activeIntervalCount(); }
u32 intervalPeriodAt(u32 index) { return WasmHost::instance().intervalPeriodAt(index); }
u32 activeGpioListenerCount() { return WasmHost::instance().activeGpioCount(); }
void clearPins() { WasmHost::instance().clearPins(); }
}
