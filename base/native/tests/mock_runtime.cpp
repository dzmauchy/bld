#include "mock_runtime.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <ranges>

namespace {

constexpr auto invoke = [](auto* callback) {
  if (callback) {
    (*callback)();
  }
};

constexpr auto isActive = [](const auto& item) { return item.active; };

}  // namespace

auto& MockRuntime::instance() {
  static auto runtime = MockRuntime{};
  return runtime;
}

void MockRuntime::reset() { instance() = MockRuntime(); }

void MockRuntime::start() {
  auto callbacks = instance().start_;
  std::ranges::for_each(callbacks, invoke);
}

void MockRuntime::close() {
  auto callbacks = instance().close_;
  std::ranges::for_each(callbacks, invoke);
}

void MockRuntime::tick() {
  auto intervals = instance().intervals_;
  for (const auto& interval : intervals | std::views::filter(isActive)) {
    invoke(interval.callback);
  }
}

void MockRuntime::setNow(u64 milliseconds) { instance().now_ = milliseconds; }

void MockRuntime::setRandom(f32 value) { instance().random_ = value; }

void MockRuntime::emitGpio(u32 port, u8 pin, bool value) { instance().handleSendGpio(port, pin, value); }

auto MockRuntime::hasF32(u32 blockId, u8 channel) -> bool { return instance().valuesF32_.contains({blockId, channel}); }

auto MockRuntime::lastF32(u32 blockId, u8 channel) -> f32 {
  auto& values = instance().valuesF32_;
  if (auto it = values.find({blockId, channel}); it != values.end()) {
    return it->second;
  }
  return std::numeric_limits<f32>::quiet_NaN();
}

auto MockRuntime::activeIntervalCount() -> u32 { return static_cast<u32>(std::ranges::count_if(instance().intervals_, isActive)); }

auto MockRuntime::activeGpioCount() -> u32 { return static_cast<u32>(std::ranges::count_if(instance().gpio_, isActive)); }

auto MockRuntime::intervalPeriodAt(u32 index) -> u32 {
  auto active = instance().intervals_ | std::views::filter(isActive) | std::views::drop(index);
  if (auto it = std::ranges::begin(active); it != std::ranges::end(active)) {
    return it->period;
  }
  return 0;
}

void MockRuntime::handleOnStart(Callback* callback) { start_.push_back(callback); }

void MockRuntime::handleOnClose(Callback* callback) { close_.push_back(callback); }

void MockRuntime::handleOnStop(Callback* callback) { stop_.push_back(callback); }

auto MockRuntime::handleSetInterval(u32 milliseconds, Callback* callback) -> u32 {
  auto id = nextIntervalId_++;
  intervals_.push_back({.id = id, .period = milliseconds, .callback = callback, .active = true});
  return id;
}

void MockRuntime::handleClearInterval(u32 intervalId) {
  std::ranges::for_each(intervals_, [intervalId](auto& interval) {
    if (interval.id == intervalId) {
      interval.active = false;
    }
  });
}

auto MockRuntime::handleReadGpio(u32 port, u8 pin) const -> bool {
  if (auto it = gpioValues_.find({port, pin}); it != gpioValues_.end()) {
    return it->second;
  }
  return false;
}

auto MockRuntime::handleSetGpio(u32 port, u8 pin, Callback* callback) -> u32 {
  auto id = nextGpioId_++;
  gpio_.push_back({.id = id, .port = port, .pin = pin, .callback = callback, .active = true});
  return id;
}

void MockRuntime::handleClearGpio(u32 gpioId) {
  std::ranges::for_each(gpio_, [gpioId](auto& listener) {
    if (listener.id == gpioId) {
      listener.active = false;
    }
  });
}

void MockRuntime::handleSendGpio(u32 port, u8 pin, bool value) {
  gpioValues_[{port, pin}] = value;
  fireGpio(port, pin);
}

void MockRuntime::handleSendF32(u32 blockId, u8 inputId, f32 value) { valuesF32_[{blockId, inputId}] = value; }

void MockRuntime::handleSendF64(u32 blockId, u8 inputId, f64 value) { valuesF64_[{blockId, inputId}] = value; }

auto MockRuntime::handleRandomF32() const -> f32 { return random_; }

auto MockRuntime::handleRandomF64() const -> f64 { return static_cast<f64>(random_); }

auto MockRuntime::handleGetTime() const -> u64 { return now_; }

void MockRuntime::fireGpio(u32 port, u8 pin) {
  auto listeners = gpio_;
  for (const auto& listener : listeners | std::views::filter(isActive)) {
    if (listener.port == port && listener.pin == pin) {
      invoke(listener.callback);
    }
  }
}

extern "C" {

void on_close(Callback* cbk) { MockRuntime::instance().handleOnClose(cbk); }
void on_start(Callback* cbk) { MockRuntime::instance().handleOnStart(cbk); }
void on_stop(Callback* cbk) { MockRuntime::instance().handleOnStop(cbk); }

u32 set_interval(u32 milliseconds, Callback* cbk) { return MockRuntime::instance().handleSetInterval(milliseconds, cbk); }
void clear_interval(u32 intervalId) { MockRuntime::instance().handleClearInterval(intervalId); }

bool read_gpio(u32 port, u8 pin) { return MockRuntime::instance().handleReadGpio(port, pin); }
u32 set_gpio(u32 port, u8 pin, Callback* cbk) { return MockRuntime::instance().handleSetGpio(port, pin, cbk); }
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
