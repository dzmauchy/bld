#pragma once

#include <bld.hpp>

template <typename T>
using Pss = Consumer<T>;

template <typename T>
using VectorizedInput = Array<T*>;

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
    explicit ClearGpioHandlesCallback(Array<u32> handles) : handles_(static_cast<Array<u32>&&>(handles)) {}
    void operator()() override {
      for (auto handle : handles_) {
        clearGpio(handle);
      }
    }

   private:
    Array<u32> handles_;
  };

  void onStart(auto& callback) { on_start(&callback); }

  void onClose(auto& callback) { on_close(&callback); }

  [[nodiscard]] auto setInterval(auto milliseconds, auto& callback) { return set_interval(milliseconds, &callback); }

  static void clearInterval(auto intervalId) { clear_interval(intervalId); }

  [[nodiscard]] auto setGpio(auto port, auto pin, auto& callback) { return set_gpio(port, pin, &callback); }

  static void clearGpio(auto gpioId) { clear_gpio(gpioId); }

  void armInterval(auto milliseconds, auto& tick, auto& closeSlot) {
    auto timer = setInterval(milliseconds, tick);
    closeSlot.emplace(timer);
    onClose(*closeSlot);
  }

  void sendF32(auto channel, auto value) const { send_value_f32(blockId, channel, value); }

  static void pushTo(const auto& sinks, auto value) {
    for (auto* sink : sinks) {
      if (sink) {
        (*sink)(value);
      }
    }
  }

  [[nodiscard]] static auto pointersOf(auto& items) {
    auto result = VectorizedInput<Pss<f32>>{};
    result.reserve(items.size());
    for (auto& item : items) {
      result.push_back(&item);
    }
    return result;
  }
};

namespace push::f32 {

using F32 = ::f32;

inline constexpr auto kTwoPi = 2.f * 3.1415926f;

[[nodiscard]] inline auto wrapTwoPi(F32 angle) {
  while (angle >= kTwoPi) {
    angle -= kTwoPi;
  }
  while (angle < 0) {
    angle += kTwoPi;
  }
  return angle;
}

class UnaryTransformerF32 : public NativeBlock {
 public:
  ~UnaryTransformerF32() override = default;

  [[nodiscard]] auto apply(VectorizedInput<Pss<F32>> downstream) {
    push_.emplace(*this, static_cast<VectorizedInput<Pss<F32>>&&>(downstream));
    return &*push_;
  }

 protected:
  using NativeBlock::NativeBlock;
  [[nodiscard]] virtual F32 transform(F32 value) const = 0;

 private:
  class Push final : public Pss<F32> {
   public:
    Push(UnaryTransformerF32& transformer, VectorizedInput<Pss<F32>> downstream)
        : transformer_(&transformer), downstream_(static_cast<VectorizedInput<Pss<F32>>&&>(downstream)) {}

    void operator()(F32 value) override { NativeBlock::pushTo(downstream_, transformer_->transform(value)); }

   private:
    UnaryTransformerF32* transformer_;
    VectorizedInput<Pss<F32>> downstream_;
  };

  Maybe<Push> push_{};
};

class AggregateF32 : public NativeBlock {
 public:
  ~AggregateF32() override = default;

  [[nodiscard]] auto apply(VectorizedInput<Pss<F32>> downstream, u8 n) {
    downstream_ = static_cast<VectorizedInput<Pss<F32>>&&>(downstream);
    return bindInputs(n);
  }

  [[nodiscard]] auto precision() const { return precision_; }

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

  [[nodiscard]] auto bindInputs(u8 n) -> VectorizedInput<Pss<F32>> {
    values_.assign(n, nan_f32());
    inputs_.clear();
    inputs_.reserve(n);
    for (u8 i = 0; i < n; ++i) {
      inputs_.emplace_back(*this, i);
    }
    auto result = pointersOf(inputs_);
    tick_.emplace(*this);
    start_.emplace(*this);
    onStart(*start_);
    return result;
  }

  void emitIfFinite() const {
    if (values_.empty()) {
      return;
    }
    for (auto value : values_) {
      if (!is_finite_f32(value)) {
        return;
      }
    }
    auto acc = values_[0];
    for (u32 i = 1; i < values_.size(); ++i) {
      acc = combine(acc, values_[i]);
    }
    if (is_finite_f32(acc)) {
      pushTo(downstream_, acc);
    }
  }

  u32 precision_;
  VectorizedInput<Pss<F32>> downstream_{};
  Array<F32> values_{};
  Array<ChannelInput> inputs_{};
  Maybe<Tick> tick_{};
  Maybe<Start> start_{};
  Maybe<ClearIntervalCallback> close_{};
};

class PeriodicSourceF32 : public NativeBlock {
 public:
  ~PeriodicSourceF32() override = default;

  void apply(VectorizedInput<Pss<F32>> downstream) {
    downstream_ = static_cast<VectorizedInput<Pss<F32>>&&>(downstream);
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

  Maybe<Tick> tick_{};
  Maybe<Start> start_{};
  Maybe<ClearIntervalCallback> close_{};
};

class WaveGenF32 : public PeriodicSourceF32 {
 public:
  ~WaveGenF32() override = default;

  [[nodiscard]] auto precision() const { return intervalMs_; }
  [[nodiscard]] auto frequency() const { return frequency_; }
  [[nodiscard]] auto amplitude() const { return amplitude_; }
  [[nodiscard]] auto phase() const { return phase_; }

 protected:
  WaveGenF32(u32 blockId, u32 precision, F32 frequency, F32 amplitude, F32 phase)
      : PeriodicSourceF32(blockId, precision), frequency_(frequency), amplitude_(amplitude), phase_(phase) {}

  void onStarted() override { t0_ = get_time(); }

  [[nodiscard]] F32 sample() override {
    const auto elapsedSec = static_cast<F32>(static_cast<f64>(get_time() - t0_) * 0.001);
    const auto angle = wrapTwoPi(elapsedSec * frequency_ * kTwoPi + phase_);
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

  [[nodiscard]] auto apply(u8 n) { return makeChannels(n); }

  [[nodiscard]] auto period() const { return period_; }
  [[nodiscard]] auto precision() const { return precision_; }

 private:
  class ChannelSink final : public Pss<F32> {
   public:
    ChannelSink(ScopeF32& scope, u8 channel) : scope_(&scope), channel_(channel) {}

    void operator()(F32 value) override { scope_->sendF32(channel_, value); }

   private:
    ScopeF32* scope_;
    u8 channel_;
  };

  [[nodiscard]] auto makeChannels(u8 n) -> VectorizedInput<Pss<F32>> {
    channels_.clear();
    channels_.reserve(n);
    for (u8 i = 0; i < n; ++i) {
      channels_.emplace_back(*this, i);
    }
    return pointersOf(channels_);
  }

  u32 period_;
  u32 precision_;
  Array<ChannelSink> channels_{};
};

}  // namespace sinks

namespace sources {

class GpioInF32 : public NativeBlock {
 public:
  explicit GpioInF32(u32 blockId, u16 port = 0, Array<u8> pins = {0}) : NativeBlock(blockId), port_(static_cast<u16>(port)), pins_(static_cast<Array<u8>&&>(pins)) {}

  void apply(Array<VectorizedInput<Pss<F32>>> pin) {
    pinConsumers_ = static_cast<Array<VectorizedInput<Pss<F32>>>&&>(pin);
    handlers_.clear();
    handlers_.reserve(pins_.size());
    for (auto pinNumber : pins_) {
      handlers_.emplace_back(*this, pinNumber);
    }
    start_.emplace(*this);
    onStart(*start_);
  }

  [[nodiscard]] auto port() const { return port_; }
  [[nodiscard]] auto pins() const -> const Array<u8>& { return pins_; }

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
      auto handles = Array<u32>{};
      handles.reserve(gpio_->handlers_.size());
      for (u32 i = 0; i < gpio_->handlers_.size(); ++i) {
        handles.push_back(gpio_->setGpio(gpio_->port_, gpio_->pins_[i], gpio_->handlers_[i]));
      }
      gpio_->close_.emplace(static_cast<Array<u32>&&>(handles));
      gpio_->onClose(*gpio_->close_);
    }

   private:
    GpioInF32* gpio_;
  };

  [[nodiscard]] auto searchPin(u8 pin) const -> u32 {
    for (u32 i = 0; i < pins_.size(); ++i) {
      if (pins_[i] == pin) {
        return i;
      }
    }
    return pins_.size();
  }

  void emitPin(u8 pinNumber) const {
    const auto idx = searchPin(pinNumber);
    if (idx < pinConsumers_.size()) {
      auto value = read_gpio(port_, pinNumber) ? 1.f : 0.f;
      pushTo(pinConsumers_[idx], value);
    }
  }

  u16 port_;
  Array<u8> pins_;
  Array<VectorizedInput<Pss<F32>>> pinConsumers_{};
  Array<PinHandler> handlers_{};
  Maybe<Start> start_{};
  Maybe<ClearGpioHandlesCallback> close_{};
};

class ConstF32 : public NativeBlock {
 public:
  explicit ConstF32(u32 blockId, F32 v = 1) : NativeBlock(blockId), v_(v) {}

  void apply(VectorizedInput<Pss<F32>> downstream) {
    start_.emplace(*this, static_cast<VectorizedInput<Pss<F32>>&&>(downstream));
    onStart(*start_);
  }

  [[nodiscard]] auto value() const { return v_; }

 private:
  class Start final : public Callback {
   public:
    Start(ConstF32& constant, VectorizedInput<Pss<F32>> sinks) : constant_(&constant), sinks_(static_cast<VectorizedInput<Pss<F32>>&&>(sinks)) {}
    void operator()() override { NativeBlock::pushTo(sinks_, constant_->v_); }

   private:
    ConstF32* constant_;
    VectorizedInput<Pss<F32>> sinks_;
  };

  F32 v_;
  Maybe<Start> start_{};
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

  [[nodiscard]] auto precision() const { return intervalMs_; }
  [[nodiscard]] auto amplitude() const { return amplitude_; }

 protected:
  [[nodiscard]] F32 sample() override { return random_f32() * amplitude_; }

 private:
  F32 amplitude_;
};

class PulseGenF32 : public PeriodicSourceF32 {
 public:
  explicit PulseGenF32(u32 blockId, F32 dutyCycle = 0.5f, F32 amplitude = 1, F32 frequency = 1, F32 phase = 0)
      : PeriodicSourceF32(blockId, 1), dutyCycle_(dutyCycle), amplitude_(amplitude), frequency_(frequency), phase_(phase) {}

  [[nodiscard]] auto dutyCycle() const { return dutyCycle_; }
  [[nodiscard]] auto amplitude() const { return amplitude_; }
  [[nodiscard]] auto frequency() const { return frequency_; }
  [[nodiscard]] auto phase() const { return phase_; }

 protected:
  void onStarted() override { t0_ = get_time(); }

  [[nodiscard]] F32 sample() override {
    const auto elapsedSec = static_cast<F32>(static_cast<f64>(get_time() - t0_) * 0.001);
    const auto angle = wrapTwoPi(elapsedSec * frequency_ * kTwoPi + phase_);
    const auto progress = angle / kTwoPi;
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
