#include <doctest/doctest.h>
#include <stdexcept>
#include <string>
#include <vector>

// Example helper function (replace with your project code/headers)
int add(int a, int b) {
    return a + b;
}

// TEST_SUITE and TEST_CASE
TEST_SUITE("BasicMathTest") {
    TEST_CASE("HandlesPositiveIntegers") {
        CHECK_EQ(add(2, 3), 5);
        CHECK_EQ(add(10, 20), 30);
    }

    TEST_CASE("HandlesNegativeIntegers") {
        CHECK_EQ(add(-2, -3), -5);
        CHECK_EQ(add(-5, 5), 0);
    }
}

// Demonstrating CHECK_* vs REQUIRE_*
TEST_SUITE("AssertionDemo") {
    TEST_CASE("StringAndComparisonChecks") {
        std::string text = "BASE block library";

        // CHECK_* records failure but continues executing the rest of the test
        CHECK_FALSE(text.empty());
        CHECK_EQ(text.length(), 18);

        // REQUIRE_* aborts the current test immediately if it fails
        REQUIRE(text.starts_with("BASE"));
        CHECK_NE(text, "other");
    }
}

// Testing exceptions
void riskyFunction(int value) {
    if (value < 0) {
        throw std::invalid_argument("Negative values not allowed");
    }
}

TEST_SUITE("ExceptionTest") {
    TEST_CASE("ThrowsOnNegativeInput") {
        CHECK_THROWS_AS(riskyFunction(-1), std::invalid_argument);
        CHECK_NOTHROW(riskyFunction(10));
    }
}
