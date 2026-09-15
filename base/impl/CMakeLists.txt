cmake_minimum_required(VERSION 4.3)

project(base
  VERSION 0.1.0
  DESCRIPTION "BASE block library implementation"
  LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(base INTERFACE)
target_compile_features(base INTERFACE cxx_std_23)
target_include_directories(base INTERFACE
  "${CMAKE_CURRENT_SOURCE_DIR}/src"
)
target_sources(base INTERFACE
  "src/base/base.hpp"
  "src/bld.hpp"
)

include(CTest)
if(BUILD_TESTING)
  include(FetchContent)
  FetchContent_Declare(
    doctest
    URL https://github.com/doctest/doctest/archive/refs/tags/v2.5.3.zip
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  )
  FetchContent_MakeAvailable(doctest)
  add_executable(base_tests tests/test_basic.cpp)
  target_link_libraries(base_tests PRIVATE
    base
    doctest::doctest_with_main
  )
  include("${doctest_SOURCE_DIR}/scripts/cmake/doctest.cmake")
  doctest_discover_tests(base_tests)
endif()
