#pragma once

#include <bld.hpp>
#include <cmath>
#include <limits>
#include <optional>
#include <vector>

template <typename T>
using Pss = Consumer<T>;

template <typename T>
using VectorizedInput = std::vector<T*>;

template <typename T>
using VectorizedOutput = Function<VectorizedInput<T>, u8>;

class NativeBlock : public Block {
 public:
  using Block::Block;
  ~NativeBlock() override = default;

 protected:
  class ClearIntervalCallback final : public Callback {
   public:
    explicit ClearIntervalCallback(u32 timer) : timer_(timer) {}
    void operator()() override { clearInterval(timer_); }

   private:
    u32 timer_;
  };

  class ClearGpioHandlesCallback final : public Callback {
   public:
    explicit ClearGpioHandlesCallback(std::vector<u32> handles) : handles_(std::move(handles)) {}
    void operator()() override {
      for (const u32 handle : handles_) {
        clearGpio(handle);
      }
    }

   private:
    std::vector<u32> handles_;
  };

  void onStart(Callback& callback) { on_start(&callback); }

  void onClose(Callback& callback) { on_close(&callback); }

  [[nodiscard]] u32 setInterval(u32 milliseconds, Callback& callback) { return set_interval(milliseconds, &callback); }

  static void clearInterval(u32 intervalId) { clear_interval(intervalId); }

  [[nodiscard]] u32 setGpio(u32 port, u8 pin, Callback& callback) { return set_gpio(port, pin, &callback); }

  static void clearGpio(u32 gpioId) { clear_gpio(gpioId); }

  void armInterval(u32 milliseconds, Callback& tick, std::optional<ClearIntervalCallback>& closeSlot) {
    const u32 timer = setInterval(milliseconds, tick);
    closeSlot.emplace(timer);
    onClose(*closeSlot);
  }

  void sendF32(u8 channel, f32 value) const { send_value_f32(blockId, channel, value); }

  static void pushTo(const VectorizedInput<Pss<f32>>& sinks, f32 value) {
    for (Pss<f32>* sink : sinks) {
      if (sink) {
        (*sink)(value);
      }
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

  [[nodiscard]] Pss<F32>* apply(VectorizedInput<Pss<F32>> downstream) {
    push_.emplace(*this, std::move(downstream));
    return &*push_;
  }

 protected:
  using NativeBlock::NativeBlock;
  [[nodiscard]] virtual F32 transform(F32 value) const = 0;

 private:
  class Push final : public Pss<F32> {
   public:
    Push(UnaryTransformerF32& transformer, VectorizedInput<Pss<F32>> downstream)
        : transformer_(&transformer), downstream_(std::move(downstream)) {}

    void operator()(F32 value) override { NativeBlock::pushTo(downstream_, transformer_->transform(value)); }

   private:
    UnaryTransformerF32* transformer_;
    VectorizedInput<Pss<F32>> downstream_;
  };

  std::optional<Push> push_{};
};

class AggregateF32 : public NativeBlock {
 public:
  ~AggregateF32() override = default;

  class Apply final : public VectorizedOutput<Pss<F32>> {
   public:
    explicit Apply(AggregateF32& aggregate) : aggregate_(&aggregate) {}

    VectorizedInput<Pss<F32>> operator()(u8 n) override { return aggregate_->bindInputs(n); }

   private:
    AggregateF32* aggregate_;
  };

  [[nodiscard]] Apply apply(VectorizedInput<Pss<F32>> downstream) {
    downstream_ = std::move(downstream);
    return Apply(*this);
  }

  [[nodiscard]] u32 precision() const { return precision_; }

 protected:
  explicit AggregateF32(u32 blockId, u32 precision = 10) : NativeBlock(blockId), precision_(precision) {}
  [[nodiscard]] virtual F32 combine(F32 acc, F32 value) const = 0;

 private:
  class ChannelInput final : public Pss<F32> {
   public:
    ChannelInput(AggregateF32& aggregate, u8 index) : aggregate_(&aggregate), index_(index) {}

    void operator()(F32 value) override { aggregate_->values_[index_] = value; }

   private:
    AggregateF32* aggregate_;
    u8 index_;
  };

  class Tick final : public Callback {
   public:
    explicit Tick(AggregateF32& aggregate) : aggregate_(&aggregate) {}
    void operator()() override { aggregate_->emitIfFinite(); }

   private:
    AggregateF32* aggregate_;
  };

  class Start final : public Callback {
   public:
    explicit Start(AggregateF32& aggregate) : aggregate_(&aggregate) {}
    void operator()() override { aggregate_->armInterval(aggregate_->precision_, *aggregate_->tick_, aggregate_->close_); }

   private:
    AggregateF32* aggregate_;
  };

  VectorizedInput<Pss<F32>> bindInputs(u8 n) {
    values_.assign(n, std::numeric_limits<F32>::quiet_NaN());
    inputs_.clear();
    inputs_.reserve(n);
    for (u8 i = 0; i < n; ++i) {
      inputs_.emplace_back(*this, i);
    }
    VectorizedInput<Pss<F32>> result;
    result.reserve(n);
    for (ChannelInput& input : inputs_) {
      result.push_back(&input);
    }
    tick_.emplace(*this);
    start_.emplace(*this);
    onStart(*start_);
    return result;
  }

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
  std::vector<ChannelInput> inputs_{};
  std::optional<Tick> tick_{};
  std::optional<Start> start_{};
  std::optional<ClearIntervalCallback> close_{};
};

class PeriodicSourceF32 : public NativeBlock {
 public:
  ~PeriodicSourceF32() override = default;

  void apply(VectorizedInput<Pss<F32>> downstream) {
    downstream_ = std::move(downstream);
    tick_.emplace(*this);
    start_.emplace(*this);
    onStart(*start_);
  }

 protected:
  PeriodicSourceF32(u32 blockId, u32 intervalMs) : NativeBlock(blockId), intervalMs_(intervalMs) {}
  virtual void onStarted() {}
  [[nodiscard]] virtual F32 sample() = 0;

  VectorizedInput<Pss<F32>> downstream_{};
  u32 intervalMs_;

 private:
  class Tick final : public Callback {
   public:
    explicit Tick(PeriodicSourceF32& source) : source_(&source) {}
    void operator()() override { NativeBlock::pushTo(source_->downstream_, source_->sample()); }

   private:
    PeriodicSourceF32* source_;
  };

  class Start final : public Callback {
   public:
    explicit Start(PeriodicSourceF32& source) : source_(&source) {}
    void operator()() override {
      source_->onStarted();
      source_->armInterval(source_->intervalMs_, *source_->tick_, source_->close_);
    }

   private:
    PeriodicSourceF32* source_;
  };

  std::optional<Tick> tick_{};
  std::optional<Start> start_{};
  std::optional<ClearIntervalCallback> close_{};
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

  class Apply final : public VectorizedOutput<Pss<F32>> {
   public:
    explicit Apply(ScopeF32& scope) : scope_(&scope) {}

    VectorizedInput<Pss<F32>> operator()(u8 n) override { return scope_->makeChannels(n); }

   private:
    ScopeF32* scope_;
  };

  [[nodiscard]] Apply apply() { return Apply(*this); }

  [[nodiscard]] u32 period() const { return period_; }
  [[nodiscard]] u32 precision() const { return precision_; }

 private:
  class ChannelSink final : public Pss<F32> {
   public:
    ChannelSink(ScopeF32& scope, u8 channel) : scope_(&scope), channel_(channel) {}

    void operator()(F32 value) override { scope_->sendF32(channel_, value); }

   private:
    ScopeF32* scope_;
    u8 channel_;
  };

  VectorizedInput<Pss<F32>> makeChannels(u8 n) {
    channels_.clear();
    channels_.reserve(n);
    for (u8 i = 0; i < n; ++i) {
      channels_.emplace_back(*this, i);
    }
    VectorizedInput<Pss<F32>> result;
    result.reserve(n);
    for (ChannelSink& channel : channels_) {
      result.push_back(&channel);
    }
    return result;
  }

  u32 period_;
  u32 precision_;
  std::vector<ChannelSink> channels_{};
};

}  // namespace sinks

namespace sources {

class GpioInF32 : public NativeBlock {
 public:
  explicit GpioInF32(u32 blockId, u16 port = 0, std::vector<u8> pins = {0}) : NativeBlock(blockId), port_(port), pins_(std::move(pins)) {}

  void apply(std::vector<VectorizedInput<Pss<F32>>> pin) {
    pinConsumers_ = std::move(pin);
    handlers_.clear();
    handlers_.reserve(pins_.size());
    for (const u8 pinNumber : pins_) {
      handlers_.emplace_back(*this, pinNumber);
    }
    start_.emplace(*this);
    onStart(*start_);
  }

  [[nodiscard]] u16 port() const { return port_; }
  [[nodiscard]] const std::vector<u8>& pins() const { return pins_; }

 private:
  class PinHandler final : public Callback {
   public:
    PinHandler(GpioInF32& gpio, u8 pinNumber) : gpio_(&gpio), pinNumber_(pinNumber) {}
    void operator()() override { gpio_->emitPin(pinNumber_); }

   private:
    GpioInF32* gpio_;
    u8 pinNumber_;
  };

  class Start final : public Callback {
   public:
    explicit Start(GpioInF32& gpio) : gpio_(&gpio) {}
    void operator()() override {
      std::vector<u32> handles;
      handles.reserve(gpio_->handlers_.size());
      for (u32 i = 0; i < gpio_->handlers_.size(); ++i) {
        handles.push_back(gpio_->setGpio(gpio_->port_, gpio_->pins_[i], gpio_->handlers_[i]));
      }
      gpio_->close_.emplace(std::move(handles));
      gpio_->onClose(*gpio_->close_);
    }

   private:
    GpioInF32* gpio_;
  };

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
  std::vector<PinHandler> handlers_{};
  std::optional<Start> start_{};
  std::optional<ClearGpioHandlesCallback> close_{};
};

class ConstF32 : public NativeBlock {
 public:
  explicit ConstF32(u32 blockId, F32 v = 1) : NativeBlock(blockId), v_(v) {}

  void apply(VectorizedInput<Pss<F32>> downstream) {
    start_.emplace(*this, std::move(downstream));
    onStart(*start_);
  }

  [[nodiscard]] F32 value() const { return v_; }

 private:
  class Start final : public Callback {
   public:
    Start(ConstF32& constant, VectorizedInput<Pss<F32>> sinks) : constant_(&constant), sinks_(std::move(sinks)) {}
    void operator()() override { NativeBlock::pushTo(sinks_, constant_->v_); }

   private:
    ConstF32* constant_;
    VectorizedInput<Pss<F32>> sinks_;
  };

  F32 v_;
  std::optional<Start> start_{};
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
