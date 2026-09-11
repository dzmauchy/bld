#pragma once

#include <bld.hpp>

/*{"kind":"type","id":"pss","name":"Push stream","description":"A stream of data that can be pushed to","params":{"T":{"name":"Push stream type"}}}*/
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

/*{"kind":"namespace","name":"Push Dataflows","icon":"push-ns.svg","description":"Push Dataflows"}*/
namespace push {
/*{"kind":"namespace","name":"Single precision","icon":"push.f32-ns.svg","description":"Single precision push dataflows"}*/
namespace f32 {

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

/*{"kind":"namespace","name":"Transformers","icon":"push.transformers-ns.svg","description":"Transformers"}*/
namespace transformers {

/*{"kind":"block","id":"cos_f32","ns":["push","f32","transformers"],"icon":"cos.svg","title":"cos","description":"Computes the cosine of the input value"}*/
class CosF32 : public UnaryTransformerF32 {
 public:
  explicit CosF32(u32 blockId) : UnaryTransformerF32(blockId) {}

  /*{"kind":"input","vector":true,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using v = Pss<F32>*;
  /*{"kind":"output","vector":false,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using cos = Pss<F32>*;

 protected:
  [[nodiscard]] F32 transform(F32 value) const override { return ::cos_f32(value); }
};

/*{"kind":"block","id":"sin_f32","ns":["push","f32","transformers"],"icon":"sin.svg","title":"sin","description":"Computes the sine of the input value"}*/
class SinF32 : public UnaryTransformerF32 {
 public:
  explicit SinF32(u32 blockId) : UnaryTransformerF32(blockId) {}

  /*{"kind":"input","vector":true,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using v = Pss<F32>*;
  /*{"kind":"output","vector":false,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using sin = Pss<F32>*;

 protected:
  [[nodiscard]] F32 transform(F32 value) const override { return ::sin_f32(value); }
};

/*{"kind":"block","id":"product_f32","ns":["push","f32","transformers"],"icon":"product.svg","title":"Product","description":"Computes the product of the input values"}*/
class ProductF32 : public AggregateF32 {
 public:
  explicit ProductF32(
      u32 blockId,
      /*{"kind":"conf","id":"precision","type":{"raw":"u32"},"control":{"type":"slider","default":10,"min":1,"max":1000,"unit":"ms"}}*/
      u32 precision = 10)
      : AggregateF32(blockId, precision) {}

  /*{"kind":"input","vector":true,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using v = Pss<F32>*;
  /*{"kind":"output","vector":true,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using p = Pss<F32>*;

 protected:
  [[nodiscard]] F32 combine(F32 acc, F32 value) const override { return acc * value; }
};

/*{"kind":"block","id":"sum_f32","ns":["push","f32","transformers"],"icon":"sum.svg","title":"Sum","description":"Computes the sum of the input values"}*/
class SumF32 : public AggregateF32 {
 public:
  explicit SumF32(
      u32 blockId,
      /*{"kind":"conf","id":"precision","type":{"raw":"u32"},"control":{"type":"slider","default":10,"min":1,"max":1000,"unit":"ms"}}*/
      u32 precision = 10)
      : AggregateF32(blockId, precision) {}

  /*{"kind":"input","vector":true,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using v = Pss<F32>*;
  /*{"kind":"output","vector":true,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using s = Pss<F32>*;

 protected:
  [[nodiscard]] F32 combine(F32 acc, F32 value) const override { return acc + value; }
};

}  // namespace transformers

/*{"kind":"namespace","name":"Sinks","icon":"push.sinks-ns.svg","description":"Sinks"}*/
namespace sinks {

/*{"kind":"block","id":"scope_f32","ns":["push","f32","sinks"],"icon":"scope.svg","title":"Scope","description":"Displays the input values in a scope"}*/
class ScopeF32 : public NativeBlock {
 public:
  explicit ScopeF32(
      u32 blockId,
      /*{"kind":"conf","id":"period","type":{"raw":"u32"},"control":{"type":"slider","default":60,"min":10,"max":600,"unit":"s"}}*/
      u32 period = 60,
      /*{"kind":"conf","id":"precision","type":{"raw":"u32"},"control":{"type":"slider","default":10,"min":1,"max":1000,"unit":"ms"}}*/
      u32 precision = 10)
      : NativeBlock(blockId), period_(period), precision_(precision) {}

  /*{"kind":"output","vector":true,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using sink = Pss<F32>*;

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

/*{"kind":"namespace","name":"Sources","icon":"push.sources-ns.svg","description":"Sources"}*/
namespace sources {

/*{"kind":"block","id":"gpio_in_f32","ns":["push","f32","sources"],"icon":"push.gpio_in.svg","title":"GPIO Input","description":"Reads the input value from a GPIO pin"}*/
class GpioInF32 : public NativeBlock {
 public:
  explicit GpioInF32(
      u32 blockId,
      /*{"kind":"conf","id":"port","type":{"raw":"u16"},"control":{"type":"text_input","format":"u16hex","min":0,"max":65535}}*/
      u16 port = 0,
      /*{"kind":"conf","id":"pins","type":{"raw":"array","args":{"T":{"raw":"u8"}}},"control":{"type":"set_of_pins","length":{"bind":{"type":"input","id":"pin","concept":{"length":{"kind":"eq"}}}},"args":{"T":{"type":"spinner","default":0,"min":0,"max":255}},"implementation":["the control should show a row of spinners, each spinner per pin","the control should permit adding and removing pins","the pin numbers should be editable","the pin numbers should be unique and sorted ascending"]}}*/
      Array<u8> pins = {0})
      : NativeBlock(blockId), port_(static_cast<u16>(port)), pins_(static_cast<Array<u8>&&>(pins)) {}

  /*{"kind":"input","vector":true,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}},"concept":{"length":{"bind":{"type":"conf","id":"pins","control":{"length":{"kind":"eq"}}}}}}*/
  using pin = Pss<F32>*;

  void connectPin(u8 pinIndex, VectorizedInput<Pss<F32>> sinks) {
    if (pinIndex >= kMaxPins) {
      return;
    }
    pinConsumers_[pinIndex] = static_cast<VectorizedInput<Pss<F32>>&&>(sinks);
    if (pinIndex + 1 > connected_) {
      connected_ = static_cast<u8>(pinIndex + 1);
    }
  }

  void apply() {
    for (u32 i = 0; i < pins_.size() && i < kMaxPins; ++i) {
      handlers_[i] = new PinHandler(*this, pins_[i]);
      handles_[i] = setGpio(port_, pins_[i], *handlers_[i]);
      handleCount_ = i + 1;
    }
    close_.emplace(*this);
    onClose(*close_);
  }

  [[nodiscard]] auto port() const { return port_; }
  [[nodiscard]] auto pins() const -> const Array<u8>& { return pins_; }

 private:
  static constexpr u8 kMaxPins = 8;

  class PinHandler final : public Callback {
   public:
    PinHandler(GpioInF32& gpio, u8 pinNumber) : gpio_(&gpio), pinNumber_(pinNumber) {}
    void operator()() override { gpio_->emitPin(pinNumber_); }

   private:
    GpioInF32* gpio_;
    u8 pinNumber_;
  };

  class Close final : public Callback {
   public:
    explicit Close(GpioInF32& gpio) : gpio_(&gpio) {}
    void operator()() override {
      for (u32 i = 0; i < gpio_->handleCount_; ++i) {
        clearGpio(gpio_->handles_[i]);
      }
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
    if (idx < connected_) {
      pushTo(pinConsumers_[idx], read_gpio(port_, pinNumber) ? 1.f : 0.f);
    }
  }

  u16 port_;
  Array<u8> pins_;
  VectorizedInput<Pss<F32>> pinConsumers_[kMaxPins]{};
  PinHandler* handlers_[kMaxPins]{};
  u32 handles_[kMaxPins]{};
  u32 handleCount_{0};
  u8 connected_{0};
  Maybe<Close> close_{};
};

/*{"kind":"block","id":"const_f32","ns":["push","f32","sources"],"icon":"push.const.svg","title":"Constant","description":"Constant value","implementation":["the implementation should propagate the constant value across all streams"]}*/
class ConstF32 : public NativeBlock {
 public:
  explicit ConstF32(
      u32 blockId,
      /*{"kind":"conf","id":"v","type":{"raw":"f32"},"control":{"type":"text_input","format":"f32","default":1,"implementation":["the control should be able to define a constant value"]}}*/
      F32 v = 1)
      : NativeBlock(blockId), v_(v) {}

  /*{"kind":"input","vector":true,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using v = Pss<F32>*;

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

/*{"kind":"block","id":"cos_gen_f32","ns":["push","f32","sources"],"icon":"push.cos-gen.svg","title":"cos","description":"Cosine generator"}*/
class CosGenF32 : public WaveGenF32 {
 public:
  explicit CosGenF32(
      u32 blockId,
      /*{"kind":"conf","id":"precision","type":{"raw":"u32"},"control":{"type":"slider","default":10,"min":1,"max":1000,"unit":"ms"}}*/
      u32 precision = 10,
      /*{"kind":"conf","id":"frequency","type":{"raw":"f32"},"control":{"type":"text_input","default":1,"min":0.001,"max":100,"format":"f32","unit":"Hz"}}*/
      F32 frequency = 1,
      /*{"kind":"conf","id":"amplitude","type":{"raw":"f32"},"control":{"type":"text_input","default":1,"format":"f32"}}*/
      F32 amplitude = 1,
      /*{"kind":"conf","id":"phase","type":{"raw":"f32"},"control":{"type":"text_input","default":0,"format":"f32","unit":"Radians"}}*/
      F32 phase = 0)
      : WaveGenF32(blockId, precision, frequency, amplitude, phase) {}

  /*{"kind":"input","vector":true,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using v = Pss<F32>*;

 protected:
  [[nodiscard]] F32 wave(F32 angle) const override { return ::cos_f32(angle); }
};

/*{"kind":"block","id":"sin_gen_f32","ns":["push","f32","sources"],"icon":"push.sin-gen.svg","title":"sin","description":"Sine generator"}*/
class SinGenF32 : public WaveGenF32 {
 public:
  explicit SinGenF32(
      u32 blockId,
      /*{"kind":"conf","id":"precision","type":{"raw":"u32"},"control":{"type":"slider","default":10,"min":1,"max":1000,"unit":"ms"}}*/
      u32 precision = 10,
      /*{"kind":"conf","id":"frequency","type":{"raw":"f32"},"control":{"type":"text_input","default":1,"min":0.001,"max":100,"format":"f32","unit":"Hz"}}*/
      F32 frequency = 1,
      /*{"kind":"conf","id":"amplitude","type":{"raw":"f32"},"control":{"type":"text_input","default":1,"format":"f32"}}*/
      F32 amplitude = 1,
      /*{"kind":"conf","id":"phase","type":{"raw":"f32"},"control":{"type":"text_input","default":0,"format":"f32","unit":"Radians"}}*/
      F32 phase = 0)
      : WaveGenF32(blockId, precision, frequency, amplitude, phase) {}

  /*{"kind":"input","vector":true,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using v = Pss<F32>*;

 protected:
  [[nodiscard]] F32 wave(F32 angle) const override { return ::sin_f32(angle); }
};

/*{"kind":"block","id":"rand_gen_f32","ns":["push","f32","sources"],"icon":"push.rand-gen.svg","title":"Random","description":"Random generator"}*/
class RandGenF32 : public PeriodicSourceF32 {
 public:
  explicit RandGenF32(
      u32 blockId,
      /*{"kind":"conf","id":"precision","type":{"raw":"u32"},"control":{"type":"slider","default":10,"min":1,"max":1000,"unit":"ms"}}*/
      u32 precision = 10,
      /*{"kind":"conf","id":"amplitude","type":{"raw":"f32"},"control":{"type":"text_input","default":1,"format":"f32"}}*/
      F32 amplitude = 1)
      : PeriodicSourceF32(blockId, precision), amplitude_(amplitude) {}

  /*{"kind":"input","vector":true,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using v = Pss<F32>*;

  [[nodiscard]] auto precision() const { return intervalMs_; }
  [[nodiscard]] auto amplitude() const { return amplitude_; }

 protected:
  [[nodiscard]] F32 sample() override { return random_f32() * amplitude_; }

 private:
  F32 amplitude_;
};

/*{"kind":"block","id":"pulse_gen_f32","ns":["push","f32","sources"],"icon":"push.pulse-gen.svg","title":"Pulse","description":"Pulse signal generator"}*/
class PulseGenF32 : public PeriodicSourceF32 {
 public:
  explicit PulseGenF32(
      u32 blockId,
      /*{"kind":"conf","id":"duty_cycle","type":{"raw":"f32"},"control":{"type":"slider","default":0.5,"min":0.0,"max":1.0,"step":0.01}}*/
      F32 dutyCycle = 0.5f,
      /*{"kind":"conf","id":"amplitude","type":{"raw":"f32"},"control":{"type":"text_input","default":1,"format":"f32"}}*/
      F32 amplitude = 1,
      /*{"kind":"conf","id":"frequency","type":{"raw":"f32"},"control":{"type":"text_input","default":1,"min":0.001,"max":100,"format":"f32","unit":"Hz"}}*/
      F32 frequency = 1,
      /*{"kind":"conf","id":"phase","type":{"raw":"f32"},"control":{"type":"text_input","default":0,"format":"f32","unit":"Radians"}}*/
      F32 phase = 0)
      : PeriodicSourceF32(blockId, 1), dutyCycle_(dutyCycle), amplitude_(amplitude), frequency_(frequency), phase_(phase) {}

  /*{"kind":"input","vector":true,"type":{"raw":"pss","args":{"T":{"raw":"f32"}}}}*/
  using v = Pss<F32>*;

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

}  // namespace f32
}  // namespace push
