#pragma once

#include <bld.hpp>
#include <map>
#include <utility>
#include <vector>

class MockRuntime {
 public:
  static MockRuntime& instance();

  static void reset();
  static void start();
  static void close();
  static void tick();
  static void setNow(u64 milliseconds);
  static void setRandom(f32 value);
  static void emitGpio(u32 port, u8 pin, bool value);
  static bool hasF32(u32 blockId, u8 channel);
  static f32 lastF32(u32 blockId, u8 channel);
  static u32 activeIntervalCount();
  static u32 activeGpioCount();
  static u32 intervalPeriodAt(u32 index);

  void handleOnStart(Callback callback);
  void handleOnClose(Callback callback);
  void handleOnStop(Callback callback);
  u32 handleSetInterval(u32 milliseconds, Callback callback);
  void handleClearInterval(u32 intervalId);
  bool handleReadGpio(u32 port, u8 pin) const;
  u32 handleSetGpio(u32 port, u8 pin, Callback callback);
  void handleClearGpio(u32 gpioId);
  void handleSendGpio(u32 port, u8 pin, bool value);
  void handleSendF32(u32 blockId, u8 inputId, f32 value);
  void handleSendF64(u32 blockId, u8 inputId, f64 value);
  f32 handleRandomF32() const;
  f64 handleRandomF64() const;
  u64 handleGetTime() const;

 private:
  struct Interval {
    u32 id;
    u32 period;
    Callback callback;
    bool active;
  };

  struct GpioListener {
    u32 id;
    u32 port;
    u8 pin;
    Callback callback;
    bool active;
  };

  void fireGpio(u32 port, u8 pin);

  std::vector<Callback> start_{};
  std::vector<Callback> close_{};
  std::vector<Callback> stop_{};
  std::vector<Interval> intervals_{};
  std::vector<GpioListener> gpio_{};
  std::map<std::pair<u32, u8>, bool> gpioValues_{};
  std::map<std::pair<u32, u8>, f32> valuesF32_{};
  std::map<std::pair<u32, u8>, f64> valuesF64_{};
  u32 nextIntervalId_{1};
  u32 nextGpioId_{1};
  u64 now_{0};
  f32 random_{0};
};
