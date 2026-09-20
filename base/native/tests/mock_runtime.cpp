#include "mock_runtime.hpp"

#include <cmath>
#include <limits>

MockRuntime& MockRuntime::instance() {
  static MockRuntime runtime;
  return runtime;
}

void MockRuntime::reset() { instance() = MockRuntime(); }

void MockRuntime::start() {
  auto& runtime = instance();
  const auto callbacks = runtime.start_;
  for (const Callback callback : callbacks) {
    if (callback) {
      callback();
    }
  }
}

void MockRuntime::close() {
  auto& runtime = instance();
  const auto callbacks = runtime.close_;
  for (const Callback callback : callbacks) {
    if (callback) {
      callback();
    }
  }
}

void MockRuntime::tick() {
  auto& runtime = instance();
  const auto intervals = runtime.intervals_;
  for (const Interval& interval : intervals) {
    if (interval.active && interval.callback) {
      interval.callback();
    }
  }
}

void MockRuntime::setNow(u64 milliseconds) { instance().now_ = milliseconds; }

void MockRuntime::setRandom(f32 value) { instance().random_ = value; }

void MockRuntime::emitGpio(u32 port, u8 pin, bool value) { instance().handleSendGpio(port, pin, value); }

bool MockRuntime::hasF32(u32 blockId, u8 channel) { return instance().valuesF32_.contains({blockId, channel}); }

f32 MockRuntime::lastF32(u32 blockId, u8 channel) {
  const auto& values = instance().valuesF32_;
  const auto it = values.find({blockId, channel});
  if (it == values.end()) {
    return std::numeric_limits<f32>::quiet_NaN();
  }
  return it->second;
}

u32 MockRuntime::activeIntervalCount() {
  u32 count = 0;
  for (const Interval& interval : instance().intervals_) {
    if (interval.active) {
      ++count;
    }
  }
  return count;
}

u32 MockRuntime::activeGpioCount() {
  u32 count = 0;
  for (const GpioListener& listener : instance().gpio_) {
    if (listener.active) {
      ++count;
    }
  }
  return count;
}

u32 MockRuntime::intervalPeriodAt(u32 index) {
  u32 seen = 0;
  for (const Interval& interval : instance().intervals_) {
    if (!interval.active) {
      continue;
    }
    if (seen == index) {
      return interval.period;
    }
    ++seen;
  }
  return 0;
}

void MockRuntime::handleOnStart(Callback callback) { start_.push_back(callback); }

void MockRuntime::handleOnClose(Callback callback) { close_.push_back(callback); }

void MockRuntime::handleOnStop(Callback callback) { stop_.push_back(callback); }

u32 MockRuntime::handleSetInterval(u32 milliseconds, Callback callback) {
  const u32 id = nextIntervalId_++;
  intervals_.push_back(Interval{id, milliseconds, callback, true});
  return id;
}

void MockRuntime::handleClearInterval(u32 intervalId) {
  for (Interval& interval : intervals_) {
    if (interval.id == intervalId) {
      interval.active = false;
    }
  }
}

bool MockRuntime::handleReadGpio(u32 port, u8 pin) const {
  const auto it = gpioValues_.find({port, pin});
  return it != gpioValues_.end() && it->second;
}

u32 MockRuntime::handleSetGpio(u32 port, u8 pin, Callback callback) {
  const u32 id = nextGpioId_++;
  gpio_.push_back(GpioListener{id, port, pin, callback, true});
  return id;
}

void MockRuntime::handleClearGpio(u32 gpioId) {
  for (GpioListener& listener : gpio_) {
    if (listener.id == gpioId) {
      listener.active = false;
    }
  }
}

void MockRuntime::handleSendGpio(u32 port, u8 pin, bool value) {
  gpioValues_[{port, pin}] = value;
  fireGpio(port, pin);
}

void MockRuntime::handleSendF32(u32 blockId, u8 inputId, f32 value) { valuesF32_[{blockId, inputId}] = value; }

void MockRuntime::handleSendF64(u32 blockId, u8 inputId, f64 value) { valuesF64_[{blockId, inputId}] = value; }

f32 MockRuntime::handleRandomF32() const { return random_; }

f64 MockRuntime::handleRandomF64() const { return static_cast<f64>(random_); }

u64 MockRuntime::handleGetTime() const { return now_; }

void MockRuntime::fireGpio(u32 port, u8 pin) {
  const auto listeners = gpio_;
  for (const GpioListener& listener : listeners) {
    if (listener.active && listener.port == port && listener.pin == pin && listener.callback) {
      listener.callback();
    }
  }
}

extern "C" {

void on_close(Callback cbk) { MockRuntime::instance().handleOnClose(cbk); }
void on_start(Callback cbk) { MockRuntime::instance().handleOnStart(cbk); }
void on_stop(Callback cbk) { MockRuntime::instance().handleOnStop(cbk); }

u32 set_interval(u32 milliseconds, Callback cbk) { return MockRuntime::instance().handleSetInterval(milliseconds, cbk); }
void clear_interval(u32 intervalId) { MockRuntime::instance().handleClearInterval(intervalId); }

bool read_gpio(u32 port, u8 pin) { return MockRuntime::instance().handleReadGpio(port, pin); }
u32 set_gpio(u32 port, u8 pin, Callback cbk) { return MockRuntime::instance().handleSetGpio(port, pin, cbk); }
void clear_gpio(u32 gpio_id) { MockRuntime::instance().handleClearGpio(gpio_id); }
void send_gpio(u32 port, u8 pin, bool value) { MockRuntime::instance().handleSendGpio(port, pin, value); }

f32 read_adc_f32(u32, u8) { return 0; }
f64 read_adc_f64(u32, u8) { return 0; }
void send_dac_f32(u32, u8, f32) {}
void send_dac_f64(u32, u8, f64) {}

void send_value_f32(u32 blockId, u8 inputId, f32 value) { MockRuntime::instance().handleSendF32(blockId, inputId, value); }
void send_value_f64(u32 blockId, u8 inputId, f64 value) { MockRuntime::instance().handleSendF64(blockId, inputId, value); }

f32 random_f32() { return MockRuntime::instance().handleRandomF32(); }
f64 random_f64() { return MockRuntime::instance().handleRandomF64(); }

u64 get_time() { return MockRuntime::instance().handleGetTime(); }

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
}
