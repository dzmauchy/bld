#include <doctest/doctest.h>

#include <base.hpp>
#include <cmath>
#include <limits>
#include <ranges>
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
    auto scope = ScopeF32(0);
    (void)scope.apply(1);

    MockRuntime::start();
    MockRuntime::tick();

    CHECK_FALSE(MockRuntime::hasF32(0, 0));
    CHECK(std::isnan(MockRuntime::lastF32(0, 0)));
  }

  TEST_CASE_FIXTURE(BlocksFixture, "ChannelsAreIndependent") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(2);
    auto a = ConstF32(1, 1.5f);
    auto b = ConstF32(2, 9.5f);
    a.apply({sinks[0]});
    b.apply({sinks[1]});

    MockRuntime::start();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 1.5f);
    CHECK_EQ(MockRuntime::lastF32(0, 1), 9.5f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "KeepsConfiguredPeriodAndPrecision") {
    const auto scope = ScopeF32(3, 120, 25);
    CHECK_EQ(scope.id(), 3);
    CHECK_EQ(scope.period(), 120);
    CHECK_EQ(scope.precision(), 25);
  }
}

TEST_SUITE("ConstF32") {
  TEST_CASE_FIXTURE(BlocksFixture, "PushesValueToScope") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto constant = ConstF32(1, 3.5f);
    constant.apply(sinks);

    MockRuntime::start();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 3.5f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "FansOutToTwoScopeChannels") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(2);
    auto constant = ConstF32(1, 8.f);
    constant.apply(sinks);

    MockRuntime::start();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 8.f);
    CHECK_EQ(MockRuntime::lastF32(0, 1), 8.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "DefaultValueIsOne") { CHECK_EQ(ConstF32(0).value(), 1.f); }

  TEST_CASE_FIXTURE(BlocksFixture, "DoesNotRegisterAnInterval") {
    auto constant = ConstF32(1, 9.f);
    constant.apply({});

    MockRuntime::start();

    CHECK_EQ(MockRuntime::activeIntervalCount(), 0);
  }
}

TEST_SUITE("UnaryTransformers") {
  TEST_CASE_FIXTURE(BlocksFixture, "CosOfZeroIsOne") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto cos = CosF32(1);
    auto input = cos.apply(sinks);
    auto constant = ConstF32(2, 0.f);
    constant.apply({input});

    MockRuntime::start();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 1.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "SinOfZeroIsZero") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto sin = SinF32(1);
    auto input = sin.apply(sinks);
    auto constant = ConstF32(2, 0.f);
    constant.apply({input});

    MockRuntime::start();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 0.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "CosThenSinOfZeroIsSinOfOne") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto sin = SinF32(1);
    auto cos = CosF32(2);
    auto sinInput = sin.apply(sinks);
    auto cosInput = cos.apply({sinInput});
    auto constant = ConstF32(3, 0.f);
    constant.apply({cosInput});

    MockRuntime::start();

    CHECK(MockRuntime::lastF32(0, 0) == doctest::Approx(std::sin(1.f)).epsilon(kEps));
  }
}

TEST_SUITE("ProductF32") {
  TEST_CASE_FIXTURE(BlocksFixture, "MultipliesTwoConstants") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto product = ProductF32(1);
    auto inputs = product.apply(sinks,2);
    auto a = ConstF32(2, 3.f);
    auto b = ConstF32(3, 4.f);
    a.apply({inputs[0]});
    b.apply({inputs[1]});

    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 12.f);
    CHECK_EQ(product.precision(), 10);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "SingleFactorIsTheProduct") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto product = ProductF32(1);
    auto inputs = product.apply(sinks,1);
    auto a = ConstF32(2, 6.f);
    a.apply({inputs[0]});

    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 6.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "DoesNotPushWhenAFactorIsNaN") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto product = ProductF32(1);
    auto inputs = product.apply(sinks,2);
    auto a = ConstF32(2, 6.f);
    a.apply({inputs[0]});

    MockRuntime::start();
    MockRuntime::tick();

    CHECK_FALSE(MockRuntime::hasF32(0, 0));
  }

  TEST_CASE_FIXTURE(BlocksFixture, "UsesConfiguredPrecision") {
    auto product = ProductF32(1, 25);
    (void)product.apply({},1);

    MockRuntime::start();

    CHECK_EQ(MockRuntime::intervalPeriodAt(0), 25);
  }
}

TEST_SUITE("SumF32") {
  TEST_CASE_FIXTURE(BlocksFixture, "AddsTwoConstants") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto sum = SumF32(1);
    auto inputs = sum.apply(sinks,2);
    auto a = ConstF32(2, 3.f);
    auto b = ConstF32(3, 4.f);
    a.apply({inputs[0]});
    b.apply({inputs[1]});

    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 7.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "DoesNotPushWhenATermIsNonFinite") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto sum = SumF32(1);
    auto inputs = sum.apply(sinks,2);
    auto a = ConstF32(2, 6.f);
    auto b = ConstF32(3, std::numeric_limits<f32>::infinity());
    a.apply({inputs[0]});
    b.apply({inputs[1]});

    MockRuntime::start();
    MockRuntime::tick();

    CHECK_FALSE(MockRuntime::hasF32(0, 0));
  }
}

TEST_SUITE("WaveGenerators") {
  TEST_CASE_FIXTURE(BlocksFixture, "CosGenAtZeroIsOne") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto gen = CosGenF32(1);
    gen.apply(sinks);

    MockRuntime::setNow(0);
    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 1.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "SinGenAtZeroIsZero") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto gen = SinGenF32(1);
    gen.apply(sinks);

    MockRuntime::setNow(0);
    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 0.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "SinGenAtQuarterPeriodIsOne") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto gen = SinGenF32(1);
    gen.apply(sinks);

    MockRuntime::setNow(0);
    MockRuntime::start();
    MockRuntime::setNow(250);
    MockRuntime::tick();

    CHECK(MockRuntime::lastF32(0, 0) == doctest::Approx(1.f).epsilon(1e-4f));
  }

  TEST_CASE_FIXTURE(BlocksFixture, "CosGenUsesConfiguredPrecision") {
    auto gen = CosGenF32(1, 25);
    gen.apply({});

    MockRuntime::start();

    CHECK_EQ(MockRuntime::intervalPeriodAt(0), 25);
    CHECK_EQ(gen.precision(), 25);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "OnCloseClearsGeneratorInterval") {
    auto gen = CosGenF32(1);
    gen.apply({});

    MockRuntime::start();
    CHECK_EQ(MockRuntime::activeIntervalCount(), 1);
    MockRuntime::close();
    CHECK_EQ(MockRuntime::activeIntervalCount(), 0);
  }
}

TEST_SUITE("RandGenF32") {
  TEST_CASE_FIXTURE(BlocksFixture, "UsesInjectedRandomScaledByAmplitude") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto gen = RandGenF32(1, 10, 2.f);
    gen.apply(sinks);

    MockRuntime::setRandom(0.25f);
    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 0.5f);
  }
}

TEST_SUITE("PulseGenF32") {
  TEST_CASE_FIXTURE(BlocksFixture, "HighAtStartOfPeriod") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto gen = PulseGenF32(1, 0.5f);
    gen.apply(sinks);

    MockRuntime::setNow(0);
    MockRuntime::start();
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 1.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "LowAfterDutyWindow") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto gen = PulseGenF32(1, 0.5f);
    gen.apply(sinks);

    MockRuntime::setNow(0);
    MockRuntime::start();
    MockRuntime::setNow(500);
    MockRuntime::tick();

    CHECK_EQ(MockRuntime::lastF32(0, 0), 0.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "UsesOneMillisecondInterval") {
    auto gen = PulseGenF32(1);
    gen.apply({});

    MockRuntime::start();

    CHECK_EQ(MockRuntime::intervalPeriodAt(0), 1);
  }
}

TEST_SUITE("GpioInF32") {
  TEST_CASE_FIXTURE(BlocksFixture, "TrueIsOneOnScope") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto gpio = GpioInF32(1, 0, {0});
    gpio.connectPin(0, sinks);
    gpio.apply();

    MockRuntime::start();
    MockRuntime::emitGpio(0, 0, true);

    CHECK_EQ(MockRuntime::lastF32(0, 0), 1.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "FalseIsZeroOnScope") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto gpio = GpioInF32(1);
    gpio.connectPin(0, sinks);
    gpio.apply();

    MockRuntime::start();
    MockRuntime::emitGpio(0, 0, false);

    CHECK_EQ(MockRuntime::lastF32(0, 0), 0.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "IgnoresUnconfiguredPins") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto gpio = GpioInF32(1, 0, {2, 4});
    gpio.connectPin(0, sinks);
    gpio.connectPin(1, {});
    gpio.apply();

    MockRuntime::start();
    MockRuntime::emitGpio(0, 0, true);

    CHECK_FALSE(MockRuntime::hasF32(0, 0));
  }

  TEST_CASE_FIXTURE(BlocksFixture, "RoutesMultiplePins") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(2);
    auto gpio = GpioInF32(1, 7, {1, 3});
    gpio.connectPin(0, {sinks[0]});
    gpio.connectPin(1, {sinks[1]});
    gpio.apply();

    MockRuntime::start();
    MockRuntime::emitGpio(7, 1, true);
    MockRuntime::emitGpio(7, 3, false);

    CHECK_EQ(MockRuntime::lastF32(0, 0), 1.f);
    CHECK_EQ(MockRuntime::lastF32(0, 1), 0.f);
  }

  TEST_CASE_FIXTURE(BlocksFixture, "OnCloseStopsListening") {
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto gpio = GpioInF32(1);
    gpio.connectPin(0, sinks);
    gpio.apply();

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
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(1);
    auto product = ProductF32(1);
    auto factors = product.apply(sinks,2);
    auto cos = CosGenF32(2);
    auto sin = SinGenF32(3);
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
    constexpr auto kCount = u8{70};
    auto scope = ScopeF32(0);
    auto sinks = scope.apply(kCount);
    auto constants = std::vector<ConstF32>{};
    constants.reserve(kCount);
    for (auto i : std::views::iota(u8{}, kCount)) {
      constants.emplace_back(static_cast<u32>(i) + 1, static_cast<f32>(i));
    }
    for (auto i : std::views::iota(u8{}, kCount)) {
      constants[i].apply({sinks[i]});
    }

    MockRuntime::start();

    for (auto i : std::views::iota(u8{}, kCount)) {
      CHECK_EQ(MockRuntime::lastF32(0, i), static_cast<f32>(i));
    }
  }
}
