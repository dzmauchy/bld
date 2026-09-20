#include <doctest/doctest.h>

#include <base.hpp>
#include <cmath>
#include <limits>
#include <vector>

#include "../mock_runtime.hpp"

using push::f32::sinks::ScopeF32;
using push::f32::sources::ConstF32;
using push::f32::sources::CosGenF32;
using push::f32::sources::GpioInF32;
using push::f32::sources::PulseGenF32;
using push::f32::sources::RandGenF32;
using push::f32::sources::SinGenF32;
using push::f32::transformers::CosF32;
using push::f32::transformers::ProductF32;
using push::f32::transformers::SinF32;
using push::f32::transformers::SumF32;

namespace {

struct BlocksFixture {
  BlocksFixture() { MockRuntime::reset(); }
};

constexpr f32 kEps = 1e-5f;

}  // namespace

TEST_SUITE("ScopeF32") {
  TEST_CASE_FIXTURE(BlocksFixture, "DoesNotReportAValueBeforeAnyPush") {
    ScopeF32 scope(0);
    (void)scope.apply()(1);

    MockRuntime::start();
    MockRuntime::tick();

    CHECK_FALSE(MockRuntime::hasF32(0, 0));
    CHECK(std::isnan(MockRuntime::lastF32(0, 0)));
  }

  TEST_CASE_FIXTURE(BlocksFixture, "ChannelsAreIndependent") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(2);
    ConstF32 a(1, 1.5f);
    ConstF32 b(2, 9.5f);
    a.apply({sinks[0]});
    b.apply({sinks[1]});

    MockRuntime::start();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 1.5f);
    CHECK_EQ(MockRuntime::lastF32(0, 1), 9.5f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "KeepsConfiguredPeriodAndPrecision") {
    const ScopeF32 scope(3, 120, 25);
    CHECK_EQ(scope.id(), 3);
    CHECK_EQ(scope.period(), 120);
    CHECK_EQ(scope.precision(), 25);
  }
}

TEST_SUITE("ConstF32") {
  TEST_CASE_FIXTURE(BlocksFixture, "PushesValueToScope") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    ConstF32 constant(1, 3.5f);
    constant.apply(sinks);

    MockRuntime::start();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 3.5f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "FansOutToTwoScopeChannels") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(2);
    ConstF32 constant(1, 8.f);
    constant.apply(sinks);

    MockRuntime::start();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 8.f);
    CHECK_EQ(MockRuntime::lastF32(0, 1), 8.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "DefaultValueIsOne") { CHECK_EQ(ConstF32(0).value(), 1.f); }

  TEST_CASE_FIXTURE(BlocksFixture, "DoesNotRegisterAnInterval") {
    ConstF32 constant(1, 9.f);
    constant.apply({});

    MockRuntime::start();

    CHECK_EQ(MockRuntime::activeIntervalCount(), 0);
  }
}

TEST_SUITE("UnaryTransformers") {
  TEST_CASE_FIXTURE(BlocksFixture, "CosOfZeroIsOne") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    CosF32 cos(1);
    auto input = cos.apply(sinks);
    ConstF32 constant(2, 0.f);
    constant.apply({input});

    MockRuntime::start();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 1.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "SinOfZeroIsZero") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    SinF32 sin(1);
    auto input = sin.apply(sinks);
    ConstF32 constant(2, 0.f);
    constant.apply({input});

    MockRuntime::start();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 0.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "CosThenSinOfZeroIsSinOfOne") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    SinF32 sin(1);
    CosF32 cos(2);
    auto sinInput = sin.apply(sinks);
    auto cosInput = cos.apply({sinInput});
    ConstF32 constant(3, 0.f);
    constant.apply({cosInput});

    MockRuntime::start();

    CHECK(MockRuntime::lastF32(0, 0) == doctest::Approx(std::sin(1.f)).epsilon(kEps));
  }
}

TEST_SUITE("ProductF32") {
  TEST_CASE_FIXTURE(BlocksFixture, "MultipliesTwoConstants") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    ProductF32 product(1);
    auto inputs = product.apply(sinks)(2);
    ConstF32 a(2, 3.f);
    ConstF32 b(3, 4.f);
    a.apply({inputs[0]});
    b.apply({inputs[1]});

    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 12.f);
    CHECK_EQ(product.precision(), 10);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "SingleFactorIsTheProduct") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    ProductF32 product(1);
    auto inputs = product.apply(sinks)(1);
    ConstF32 a(2, 6.f);
    a.apply({inputs[0]});

    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 6.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "DoesNotPushWhenAFactorIsNaN") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    ProductF32 product(1);
    auto inputs = product.apply(sinks)(2);
    ConstF32 a(2, 6.f);
    a.apply({inputs[0]});

    MockRuntime::start();
    MockRuntime::tick();

    CHECK_FALSE(MockRuntime::hasF32(0, 0));
  }

  TEST_CASE_FIXTURE(BlocksFixture, "UsesConfiguredPrecision") {
    ProductF32 product(1, 25);
    (void)product.apply({})(1);

    MockRuntime::start();

    CHECK_EQ(MockRuntime::intervalPeriodAt(0), 25);
  }
}

TEST_SUITE("SumF32") {
  TEST_CASE_FIXTURE(BlocksFixture, "AddsTwoConstants") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    SumF32 sum(1);
    auto inputs = sum.apply(sinks)(2);
    ConstF32 a(2, 3.f);
    ConstF32 b(3, 4.f);
    a.apply({inputs[0]});
    b.apply({inputs[1]});

    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 7.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "DoesNotPushWhenATermIsNonFinite") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    SumF32 sum(1);
    auto inputs = sum.apply(sinks)(2);
    ConstF32 a(2, 6.f);
    ConstF32 b(3, std::numeric_limits<f32>::infinity());
    a.apply({inputs[0]});
    b.apply({inputs[1]});

    MockRuntime::start();
    MockRuntime::tick();

    CHECK_FALSE(MockRuntime::hasF32(0, 0));
  }
}

TEST_SUITE("WaveGenerators") {
  TEST_CASE_FIXTURE(BlocksFixture, "CosGenAtZeroIsOne") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    CosGenF32 gen(1);
    gen.apply(sinks);

    MockRuntime::setNow(0);
    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 1.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "SinGenAtZeroIsZero") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    SinGenF32 gen(1);
    gen.apply(sinks);

    MockRuntime::setNow(0);
    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 0.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "SinGenAtQuarterPeriodIsOne") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    SinGenF32 gen(1);
    gen.apply(sinks);

    MockRuntime::setNow(0);
    MockRuntime::start();
    MockRuntime::setNow(250);
    MockRuntime::tick();

    CHECK(MockRuntime::lastF32(0, 0) == doctest::Approx(1.f).epsilon(1e-4f));
  }

  TEST_CASE_FIXTURE(BlocksFixture, "CosGenUsesConfiguredPrecision") {
    CosGenF32 gen(1, 25);
    gen.apply({});

    MockRuntime::start();

    CHECK_EQ(MockRuntime::intervalPeriodAt(0), 25);
    CHECK_EQ(gen.precision(), 25);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "OnCloseClearsGeneratorInterval") {
    CosGenF32 gen(1);
    gen.apply({});

    MockRuntime::start();
    CHECK_EQ(MockRuntime::activeIntervalCount(), 1);
    MockRuntime::close();
    CHECK_EQ(MockRuntime::activeIntervalCount(), 0);
  }
}

TEST_SUITE("RandGenF32") {
  TEST_CASE_FIXTURE(BlocksFixture, "UsesInjectedRandomScaledByAmplitude") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    RandGenF32 gen(1, 10, 2.f);
    gen.apply(sinks);

    MockRuntime::setRandom(0.25f);
    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 0.5f);
  }
}

TEST_SUITE("PulseGenF32") {
  TEST_CASE_FIXTURE(BlocksFixture, "HighAtStartOfPeriod") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    PulseGenF32 gen(1, 0.5f);
    gen.apply(sinks);

    MockRuntime::setNow(0);
    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 1.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "LowAfterDutyWindow") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    PulseGenF32 gen(1, 0.5f);
    gen.apply(sinks);

    MockRuntime::setNow(0);
    MockRuntime::start();
    MockRuntime::setNow(500);
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 0.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "UsesOneMillisecondInterval") {
    PulseGenF32 gen(1);
    gen.apply({});

    MockRuntime::start();

    CHECK_EQ(MockRuntime::intervalPeriodAt(0), 1);
  }
}

TEST_SUITE("GpioInF32") {
  TEST_CASE_FIXTURE(BlocksFixture, "TrueIsOneOnScope") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    GpioInF32 gpio(1, 0, {0});
    gpio.apply({sinks});

    MockRuntime::start();
    MockRuntime::emitGpio(0, 0, true);

    CHECK_EQ(MockRuntime::lastF32(0, 0), 1.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "FalseIsZeroOnScope") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    GpioInF32 gpio(1);
    gpio.apply({sinks});

    MockRuntime::start();
    MockRuntime::emitGpio(0, 0, false);

    CHECK_EQ(MockRuntime::lastF32(0, 0), 0.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "IgnoresUnconfiguredPins") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    GpioInF32 gpio(1, 0, {2, 4});
    gpio.apply({sinks, {}});

    MockRuntime::start();
    MockRuntime::emitGpio(0, 0, true);

    CHECK_FALSE(MockRuntime::hasF32(0, 0));
  }

  TEST_CASE_FIXTURE(BlocksFixture, "RoutesMultiplePins") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(2);
    GpioInF32 gpio(1, 7, {1, 3});
    gpio.apply({{sinks[0]}, {sinks[1]}});

    MockRuntime::start();
    MockRuntime::emitGpio(7, 1, true);
    MockRuntime::emitGpio(7, 3, false);

    CHECK_EQ(MockRuntime::lastF32(0, 0), 1.f);
    CHECK_EQ(MockRuntime::lastF32(0, 1), 0.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "OnCloseStopsListening") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    GpioInF32 gpio(1);
    gpio.apply({sinks});

    MockRuntime::start();
    CHECK_EQ(MockRuntime::activeGpioCount(), 1);
    MockRuntime::close();
    CHECK_EQ(MockRuntime::activeGpioCount(), 0);
    MockRuntime::emitGpio(0, 0, true);
    CHECK_FALSE(MockRuntime::hasF32(0, 0));
  }
}

TEST_SUITE("CompositeDiagrams") {
  TEST_CASE_FIXTURE(BlocksFixture, "CosTimesSinAtQuarterPeriod") {
    ScopeF32 scope(0);
    auto sinks = scope.apply()(1);
    ProductF32 product(1);
    auto factors = product.apply(sinks)(2);
    CosGenF32 cos(2);
    SinGenF32 sin(3);
    cos.apply({factors[0]});
    sin.apply({factors[1]});

    MockRuntime::setNow(0);
    MockRuntime::start();
    MockRuntime::setNow(250);
    MockRuntime::tick();
    MockRuntime::tick();

    CHECK(MockRuntime::lastF32(0, 0) == doctest::Approx(0.f).epsilon(1e-4f));
  }

  TEST_CASE_FIXTURE(BlocksFixture, "EachBlockOwnsItsCapturedCallbacks") {
    constexpr u8 kCount = 70;
    ScopeF32 scope(0);
    auto sinks = scope.apply()(kCount);
    std::vector<ConstF32> constants;
    constants.reserve(kCount);
    for (u8 i = 0; i < kCount; ++i) {
      constants.emplace_back(static_cast<u32>(i) + 1, static_cast<f32>(i));
    }
    for (u8 i = 0; i < kCount; ++i) {
      constants[i].apply({sinks[i]});
    }

    MockRuntime::start();

    for (u8 i = 0; i < kCount; ++i) {
      CHECK_EQ(MockRuntime::lastF32(0, i), static_cast<f32>(i));
    }
  }
}
