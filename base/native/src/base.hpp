#pragma once

#include <array>
#include <bld.hpp>
#include <cmath>
#include <functional>
#include <limits>
#include <utility>
#include <vector>

template <typename T>
using Pss = Consumer<T>;

template <typename T>
using VectorizedInput = std::vector<T>;

template <typename T>
using VectorizedOutput = Function<std::vector<T>, u8>;

/**
 * Adapts capturing C++ callbacks to the host C function-pointer ABI by storing
 * std::function objects in a fixed table of trampolines.
 */
class CallbackBinder {
 public:
  static constexpr u32 kCapacity = 64;

  [[nodiscard]] static Callback bind(std::function<void()> callback) { return thunks()[allocate(std::move(callback))]; }

  static void reset() { slots().fill(nullptr); }

 private:
  static std::array<std::function<void()>, kCapacity>& slots() {
    static std::array<std::function<void()>, kCapacity> stored{};
    return stored;
  }

  static u32 allocate(std::function<void()> callback) {
    auto& stored = slots();
    for (u32 i = 0; i < kCapacity; ++i) {
      if (!stored[i]) {
        stored[i] = std::move(callback);
        return i;
      }
    }
    stored[0] = std::move(callback);
    return 0;
  }

  template <u32 I>
  static void invoke() {
    auto& callback = slots()[I];
    if (callback) {
      callback();
    }
  }

  template <u32... Is>
  static std::array<Callback, kCapacity> makeThunks(std::integer_sequence<u32, Is...>) {
    return {&invoke<Is>...};
  }

  static const std::array<Callback, kCapacity>& thunks() {
    static const auto table = makeThunks(std::make_integer_sequence<u32, kCapacity>{});
    return table;
  }
};

class NativeBlock : public Block {
 public:
  using Block::Block;
  ~NativeBlock() override = default;

 protected:
  void onStart(std::function<void()> callback) { on_start(CallbackBinder::bind(std::move(callback))); }

  void onClose(std::function<void()> callback) { on_close(CallbackBinder::bind(std::move(callback))); }

  [[nodiscard]] u32 setInterval(u32 milliseconds, std::function<void()> callback) {
    return set_interval(milliseconds, CallbackBinder::bind(std::move(callback)));
  }

  static void clearInterval(u32 intervalId) { clear_interval(intervalId); }

  [[nodiscard]] u32 setGpio(u32 port, u8 pin, std::function<void()> callback) { return set_gpio(port, pin, CallbackBinder::bind(std::move(callback))); }

  static void clearGpio(u32 gpioId) { clear_gpio(gpioId); }

  void sendF32(u8 channel, f32 value) const { send_value_f32(blockId, channel, value); }

  static void pushTo(const VectorizedInput<Pss<f32>>& sinks, f32 value) {
    for (const auto& sink : sinks) {
      sink(value);
    }
  }
};

namespace push::f32 {

using F32 = ::f32;

inline constexpr F32 kTwoPi = 2.f * 3.1415926f;

inline F32 wrapTwoPi(F32 angle) {
  angle = std::fmod(angle, kTwoPi);
  if (angle < 0) {
    angle += kTwoPi;
  }
  return angle;
}

class UnaryTransformerF32 : public NativeBlock {
 public:
  ~UnaryTransformerF32() override = default;

  [[nodiscard]] Pss<F32> apply(VectorizedInput<Pss<F32>> downstream) {
    return [this, sinks = std::move(downstream)](F32 value) { pushTo(sinks, transform(value)); };
  }

 protected:
  using NativeBlock::NativeBlock;
  [[nodiscard]] virtual F32 transform(F32 value) const = 0;
};

class AggregateF32 : public NativeBlock {
 public:
  ~AggregateF32() override = default;

  [[nodiscard]] VectorizedOutput<Pss<F32>> apply(VectorizedInput<Pss<F32>> downstream) {
    downstream_ = std::move(downstream);
    return [this](u8 n) {
      values_.assign(n, std::numeric_limits<F32>::quiet_NaN());
      onStart([this] {
        const u32 timer = setInterval(precision_, [this] { emitIfFinite(); });
        onClose([timer] { clearInterval(timer); });
      });
      std::vector<Pss<F32>> inputs;
      inputs.reserve(n);
      for (u8 i = 0; i < n; ++i) {
        inputs.push_back([this, i](F32 value) { values_[i] = value; });
      }
      return inputs;
    };
  }

  [[nodiscard]] u32 precision() const { return precision_; }

 protected:
  explicit AggregateF32(u32 blockId, u32 precision = 10) : NativeBlock(blockId), precision_(precision) {}
  [[nodiscard]] virtual F32 combine(F32 acc, F32 value) const = 0;

 private:
  void emitIfFinite() const {
    F32 acc = std::numeric_limits<F32>::quiet_NaN();
    for (const F32 value : values_) {
      if (std::isfinite(value)) {
        acc = std::isfinite(acc) ? combine(acc, value) : value;
      } else {
        acc = std::numeric_limits<F32>::quiet_NaN();
        break;
      }
    }
    if (std::isfinite(acc)) {
      pushTo(downstream_, acc);
    }
  }

  u32 precision_;
  VectorizedInput<Pss<F32>> downstream_{};
  std::vector<F32> values_{};
};

class PeriodicSourceF32 : public NativeBlock {
 public:
  ~PeriodicSourceF32() override = default;

  void apply(VectorizedInput<Pss<F32>> downstream) {
    downstream_ = std::move(downstream);
    onStart([this] {
      onStarted();
      const u32 timer = setInterval(intervalMs_, [this] { pushTo(downstream_, sample()); });
      onClose([timer] { clearInterval(timer); });
    });
  }

 protected:
  PeriodicSourceF32(u32 blockId, u32 intervalMs) : NativeBlock(blockId), intervalMs_(intervalMs) {}
  virtual void onStarted() {}
  [[nodiscard]] virtual F32 sample() = 0;

  VectorizedInput<Pss<F32>> downstream_{};
  u32 intervalMs_;
};

class WaveGenF32 : public PeriodicSourceF32 {
 public:
  ~WaveGenF32() override = default;

  [[nodiscard]] u32 precision() const { return intervalMs_; }
  [[nodiscard]] F32 frequency() const { return frequency_; }
  [[nodiscard]] F32 amplitude() const { return amplitude_; }
  [[nodiscard]] F32 phase() const { return phase_; }

 protected:
  WaveGenF32(u32 blockId, u32 precision, F32 frequency, F32 amplitude, F32 phase)
      : PeriodicSourceF32(blockId, precision), frequency_(frequency), amplitude_(amplitude), phase_(phase) {}

  void onStarted() override { t0_ = get_time(); }

  [[nodiscard]] F32 sample() override {
    const F32 elapsedSec = static_cast<F32>(static_cast<f64>(get_time() - t0_) * 0.001);
    const F32 angle = wrapTwoPi(elapsedSec * frequency_ * kTwoPi + phase_);
    return amplitude_ * wave(angle);
  }

  [[nodiscard]] virtual F32 wave(F32 angle) const = 0;

 private:
  F32 frequency_;
  F32 amplitude_;
  F32 phase_;
  u64 t0_{0};
};

namespace transformers {

class CosF32 : public UnaryTransformerF32 {
 public:
  explicit CosF32(u32 blockId) : UnaryTransformerF32(blockId) {}

 protected:
  [[nodiscard]] F32 transform(F32 value) const override { return ::cos_f32(value); }
};

class SinF32 : public UnaryTransformerF32 {
 public:
  explicit SinF32(u32 blockId) : UnaryTransformerF32(blockId) {}

 protected:
  [[nodiscard]] F32 transform(F32 value) const override { return ::sin_f32(value); }
};

class ProductF32 : public AggregateF32 {
 public:
  explicit ProductF32(u32 blockId, u32 precision = 10) : AggregateF32(blockId, precision) {}

 protected:
  [[nodiscard]] F32 combine(F32 acc, F32 value) const override { return acc * value; }
};

class SumF32 : public AggregateF32 {
 public:
  explicit SumF32(u32 blockId, u32 precision = 10) : AggregateF32(blockId, precision) {}

 protected:
  [[nodiscard]] F32 combine(F32 acc, F32 value) const override { return acc + value; }
};

}  // namespace transformers

namespace sinks {

class ScopeF32 : public NativeBlock {
 public:
  explicit ScopeF32(u32 blockId, u32 period = 60, u32 precision = 10) : NativeBlock(blockId), period_(period), precision_(precision) {}

  [[nodiscard]] VectorizedOutput<Pss<F32>> apply() {
    return [this](u8 n) {
      std::vector<Pss<F32>> sinks;
      sinks.reserve(n);
      for (u8 i = 0; i < n; ++i) {
        sinks.push_back([this, i](F32 value) { sendF32(i, value); });
      }
      return sinks;
    };
  }

  [[nodiscard]] u32 period() const { return period_; }
  [[nodiscard]] u32 precision() const { return precision_; }

 private:
  u32 period_;
  u32 precision_;
};

}  // namespace sinks

namespace sources {

class GpioInF32 : public NativeBlock {
 public:
  explicit GpioInF32(u32 blockId, u16 port = 0, std::vector<u8> pins = {0}) : NativeBlock(blockId), port_(port), pins_(std::move(pins)) {}

  void apply(std::vector<VectorizedInput<Pss<F32>>> pin) {
    pinConsumers_ = std::move(pin);
    onStart([this] {
      std::vector<u32> handles;
      handles.reserve(pins_.size());
      for (const u8 pinNumber : pins_) {
        handles.push_back(setGpio(port_, pinNumber, [this, pinNumber] { emitPin(pinNumber); }));
      }
      onClose([handles] {
        for (const u32 handle : handles) {
          clearGpio(handle);
        }
      });
    });
  }

  [[nodiscard]] u16 port() const { return port_; }
  [[nodiscard]] const std::vector<u8>& pins() const { return pins_; }

 private:
  [[nodiscard]] i32 searchPin(u8 pin) const {
    i32 left = 0;
    i32 right = static_cast<i32>(pins_.size()) - 1;
    while (left <= right) {
      const i32 mid = (left + right) >> 1;
      const u8 value = pins_[static_cast<u32>(mid)];
      if (value < pin) {
        left = mid + 1;
      } else if (value > pin) {
        right = mid - 1;
      } else {
        return mid;
      }
    }
    return -1;
  }

  void emitPin(u8 pinNumber) const {
    const i32 idx = searchPin(pinNumber);
    if (idx < 0 || static_cast<u32>(idx) >= pinConsumers_.size()) {
      return;
    }
    const F32 value = read_gpio(port_, pinNumber) ? 1.f : 0.f;
    pushTo(pinConsumers_[static_cast<u32>(idx)], value);
  }

  u16 port_;
  std::vector<u8> pins_;
  std::vector<VectorizedInput<Pss<F32>>> pinConsumers_{};
};

class ConstF32 : public NativeBlock {
 public:
  explicit ConstF32(u32 blockId, F32 v = 1) : NativeBlock(blockId), v_(v) {}

  void apply(VectorizedInput<Pss<F32>> downstream) {
    onStart([this, sinks = std::move(downstream)] { pushTo(sinks, v_); });
  }

  [[nodiscard]] F32 value() const { return v_; }

 private:
  F32 v_;
};

class CosGenF32 : public WaveGenF32 {
 public:
  explicit CosGenF32(u32 blockId, u32 precision = 10, F32 frequency = 1, F32 amplitude = 1, F32 phase = 0)
      : WaveGenF32(blockId, precision, frequency, amplitude, phase) {}

 protected:
  [[nodiscard]] F32 wave(F32 angle) const override { return ::cos_f32(angle); }
};

class SinGenF32 : public WaveGenF32 {
 public:
  explicit SinGenF32(u32 blockId, u32 precision = 10, F32 frequency = 1, F32 amplitude = 1, F32 phase = 0)
      : WaveGenF32(blockId, precision, frequency, amplitude, phase) {}

 protected:
  [[nodiscard]] F32 wave(F32 angle) const override { return ::sin_f32(angle); }
};

class RandGenF32 : public PeriodicSourceF32 {
 public:
  explicit RandGenF32(u32 blockId, u32 precision = 10, F32 amplitude = 1) : PeriodicSourceF32(blockId, precision), amplitude_(amplitude) {}

  [[nodiscard]] u32 precision() const { return intervalMs_; }
  [[nodiscard]] F32 amplitude() const { return amplitude_; }

 protected:
  [[nodiscard]] F32 sample() override { return random_f32() * amplitude_; }

 private:
  F32 amplitude_;
};

class PulseGenF32 : public PeriodicSourceF32 {
 public:
  explicit PulseGenF32(u32 blockId, F32 dutyCycle = 0.5f, F32 amplitude = 1, F32 frequency = 1, F32 phase = 0)
      : PeriodicSourceF32(blockId, 1), dutyCycle_(dutyCycle), amplitude_(amplitude), frequency_(frequency), phase_(phase) {}

  [[nodiscard]] F32 dutyCycle() const { return dutyCycle_; }
  [[nodiscard]] F32 amplitude() const { return amplitude_; }
  [[nodiscard]] F32 frequency() const { return frequency_; }
  [[nodiscard]] F32 phase() const { return phase_; }

 protected:
  void onStarted() override { t0_ = get_time(); }

  [[nodiscard]] F32 sample() override {
    const F32 elapsedSec = static_cast<F32>(static_cast<f64>(get_time() - t0_) * 0.001);
    const F32 angle = wrapTwoPi(elapsedSec * frequency_ * kTwoPi + phase_);
    const F32 progress = angle / kTwoPi;
    return progress < dutyCycle_ ? amplitude_ : 0.f;
  }

 private:
  F32 dutyCycle_;
  F32 amplitude_;
  F32 frequency_;
  F32 phase_;
  u64 t0_{0};
};

}  // namespace sources

}  // namespace push::f32
