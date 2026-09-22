#pragma once

#include <initializer_list>
#include <new>

#define BLD_C 0

/*{"kind":"type","id":"bool","name":"Boolean","description":"A boolean value that can be either true or false","as_arg_compatible_with":["i8","u8","i16","u16","i32","u32","i64","u64","f32","f64"]}*/
using Bool = bool;

/*{"kind":"type","id":"i8","name":"Signed 8-bit Integer","description":"A signed integer value that can hold values from -128 to 127","as_arg_compatible_with":["bool"]}*/
using i8 = signed char;
/*{"kind":"type","id":"u8","name":"Unsigned 8-bit Integer","description":"An unsigned integer value that can hold values from 0 to 255","as_arg_compatible_with":["bool"]}*/
using u8 = unsigned char;
/*{"kind":"type","id":"i16","name":"Signed 16-bit Integer","description":"A signed integer value that can hold values from -32768 to 32767","as_arg_compatible_with":["bool","i8","u8"]}*/
using i16 = short;
/*{"kind":"type","id":"u16","name":"Unsigned 16-bit Integer","description":"An unsigned integer value that can hold values from 0 to 65535","as_arg_compatible_with":["bool","i8","u8"]}*/
using u16 = unsigned short;
/*{"kind":"type","id":"i32","name":"Signed 32-bit Integer","description":"A signed integer value that can hold values from -2147483648 to 2147483647","as_arg_compatible_with":["bool","i8","u8","i16","u16"]}*/
using i32 = int;
/*{"kind":"type","id":"u32","name":"Unsigned 32-bit Integer","description":"An unsigned integer value that can hold values from 0 to 4294967295","as_arg_compatible_with":["bool","i8","u8","i16","u16"]}*/
using u32 = unsigned int;
/*{"kind":"type","id":"i64","name":"Signed 64-bit Integer","description":"A signed integer value that can hold values from -9223372036854775808 to 9223372036854775807","as_arg_compatible_with":["bool","i8","u8","i16","u16","i32","u32"]}*/
using i64 = long long;
/*{"kind":"type","id":"u64","name":"Unsigned 64-bit Integer","description":"An unsigned integer value that can hold values from 0 to 18446744073709551615","as_arg_compatible_with":["bool","i8","u8","i16","u16","i32","u32"]}*/
using u64 = unsigned long long;
/*{"kind":"type","id":"f32","name":"32-bit Floating Point Number","description":"A floating point value that can hold values from approximately -3.40282347e+38 to 3.40282347e+38","as_arg_compatible_with":["bool","i8","u8","i16","u16","i32","u32","i64","u64"]}*/
using f32 = float;
/*{"kind":"type","id":"f64","name":"64-bit Floating Point Number","description":"A floating point value that can hold values from approximately -1.7976931348623157e+308 to 1.7976931348623157e+308","as_arg_compatible_with":["bool","i8","u8","i16","u16","i32","u32","i64","u64"]}*/
using f64 = double;

/*{"kind":"type","id":"array","name":"Array","description":"An array of values","params":{"T":{"name":"Array component type"}}}*/
template <typename T>
class Array {
 public:
  Array() = default;

  Array(std::initializer_list<T> values) {
    reserve(static_cast<u32>(values.size()));
    for (const auto& value : values) {
      push_back(value);
    }
  }

  Array(const Array& other) {
    reserve(other.size_);
    for (u32 i = 0; i < other.size_; ++i) {
      push_back(other.data_[i]);
    }
  }

  Array(Array&& other) noexcept : data_(other.data_), size_(other.size_), cap_(other.cap_) {
    other.data_ = nullptr;
    other.size_ = 0;
    other.cap_ = 0;
  }

  Array& operator=(const Array& other) {
    if (this == &other) {
      return *this;
    }
    reset();
    reserve(other.size_);
    for (u32 i = 0; i < other.size_; ++i) {
      push_back(other.data_[i]);
    }
    return *this;
  }

  Array& operator=(Array&& other) noexcept {
    if (this == &other) {
      return *this;
    }
    reset();
    data_ = other.data_;
    size_ = other.size_;
    cap_ = other.cap_;
    other.data_ = nullptr;
    other.size_ = 0;
    other.cap_ = 0;
    return *this;
  }

  ~Array() { reset(); }

  void reserve(u32 n) {
    if (n <= cap_) {
      return;
    }
    auto* next = static_cast<T*>(::operator new(sizeof(T) * n));
    for (u32 i = 0; i < size_; ++i) {
      new (next + i) T(static_cast<T&&>(data_[i]));
      data_[i].~T();
    }
    if (data_) {
      ::operator delete(data_);
    }
    data_ = next;
    cap_ = n;
  }

  void push_back(const T& value) {
    grow();
    new (data_ + size_) T(value);
    ++size_;
  }

  void push_back(T&& value) {
    grow();
    new (data_ + size_) T(static_cast<T&&>(value));
    ++size_;
  }

  template <typename... Args>
  T& emplace_back(Args&&... args) {
    grow();
    new (data_ + size_) T(static_cast<Args&&>(args)...);
    ++size_;
    return data_[size_ - 1];
  }

  void assign(u32 n, const T& value) {
    reset();
    reserve(n);
    for (u32 i = 0; i < n; ++i) {
      push_back(value);
    }
  }

  void clear() {
    for (u32 i = 0; i < size_; ++i) {
      data_[i].~T();
    }
    size_ = 0;
  }

  T& operator[](u32 i) { return data_[i]; }
  const T& operator[](u32 i) const { return data_[i]; }
  [[nodiscard]] u32 size() const { return size_; }
  [[nodiscard]] bool empty() const { return size_ == 0; }
  T* begin() { return data_; }
  T* end() { return data_ + size_; }
  const T* begin() const { return data_; }
  const T* end() const { return data_ + size_; }

 private:
  void grow() {
    if (size_ == cap_) {
      reserve(cap_ == 0 ? 4u : cap_ * 2u);
    }
  }

  void reset() {
    clear();
    if (data_) {
      ::operator delete(data_);
      data_ = nullptr;
      cap_ = 0;
    }
  }

  T* data_ = nullptr;
  u32 size_ = 0;
  u32 cap_ = 0;
};

template <typename T>
[[nodiscard]] Array<T> arrayFrom(const T* items, u32 count) {
  auto result = Array<T>{};
  for (u32 i = 0; i < count; ++i) {
    result.push_back(items[i]);
  }
  return result;
}

template <typename T>
class Maybe {
 public:
  Maybe() = default;
  Maybe(T value) { emplace(static_cast<T&&>(value)); }
  Maybe(const Maybe&) = delete;
  Maybe& operator=(const Maybe&) = delete;
  Maybe(Maybe&& other) {
    if (other.has_) {
      emplace(static_cast<T&&>(*other.ptr()));
      other.reset();
    }
  }
  ~Maybe() { reset(); }

  template <typename... Args>
  T& emplace(Args&&... args) {
    reset();
    new (buf_) T(static_cast<Args&&>(args)...);
    has_ = true;
    return *ptr();
  }

  void reset() {
    if (has_) {
      ptr()->~T();
      has_ = false;
    }
  }

  explicit operator bool() const { return has_; }
  T& operator*() { return *ptr(); }
  const T& operator*() const { return *ptr(); }
  T* operator->() { return ptr(); }
  const T* operator->() const { return ptr(); }

 private:
  T* ptr() { return reinterpret_cast<T*>(buf_); }
  const T* ptr() const { return reinterpret_cast<const T*>(buf_); }

  alignas(T) unsigned char buf_[sizeof(T)]{};
  bool has_ = false;
};

inline f32 nan_f32() {
  const u32 bits = 0x7fc00000u;
  f32 value;
  __builtin_memcpy(&value, &bits, sizeof(value));
  return value;
}

inline bool is_finite_f32(f32 value) {
  u32 bits = 0;
  __builtin_memcpy(&bits, &value, sizeof(bits));
  return (bits & 0x7f800000u) != 0x7f800000u;
}

template <typename... Args>
class Consumer {
 public:
  virtual ~Consumer() = default;
  virtual void operator()(Args... args) = 0;
};

template <typename R, typename... Args>
class Function {
 public:
  virtual ~Function() = default;
  virtual R operator()(Args... args) = 0;
};

class Callback : public Consumer<> {
 public:
  ~Callback() override = default;
};

extern "C" {
/* life-cycle callbacks */
void on_close(Callback* cbk);
void on_start(Callback* cbk);
void on_stop(Callback* cbk);

/* interval management */
[[nodiscard]] u32 set_interval(u32 milliseconds, Callback* cbk);
void clear_interval(u32 intervalId);

/* gpio handling */
[[nodiscard]] bool read_gpio(u32 port, u8 pin);
[[nodiscard]] u32 set_gpio(u32 port, u8 pin, Callback* cbk);
void clear_gpio(u32 gpio_id);
void send_gpio(u32 port, u8 pin, bool value);

/* ADC/DAC */
[[nodiscard]] f32 read_adc_f32(u32 port, u8 pin);
[[nodiscard]] f64 read_adc_f64(u32 port, u8 pin);
void send_dac_f32(u32 port, u8 pin, f32 value);
void send_dac_f64(u32 port, u8 pin, f64 value);

/* metrics */
void send_value_f32(u32 blockId, u8 inputId, f32 value);
void send_value_f64(u32 blockId, u8 inputId, f64 value);

/* common functions */
[[nodiscard]] f32 random_f32();
[[nodiscard]] f64 random_f64();

/* time functions */
[[nodiscard]] u64 get_time();

/* math functions */
[[nodiscard]] f32 sin_f32(f32 value);
[[nodiscard]] f64 sin_f64(f64 value);
[[nodiscard]] f32 cos_f32(f32 value);
[[nodiscard]] f64 cos_f64(f64 value);
[[nodiscard]] f32 tan_f32(f32 value);
[[nodiscard]] f64 tan_f64(f64 value);
[[nodiscard]] f32 asin_f32(f32 value);
[[nodiscard]] f64 asin_f64(f64 value);
[[nodiscard]] f32 acos_f32(f32 value);
[[nodiscard]] f64 acos_f64(f64 value);
[[nodiscard]] f32 atan_f32(f32 value);
[[nodiscard]] f64 atan_f64(f64 value);
[[nodiscard]] f32 exp_f32(f32 value);
[[nodiscard]] f64 exp_f64(f64 value);
[[nodiscard]] f32 log_f32(f32 value);
[[nodiscard]] f64 log_f64(f64 value);
[[nodiscard]] f32 log10_f32(f32 value);
[[nodiscard]] f64 log10_f64(f64 value);
[[nodiscard]] f32 pow_f32(f32 base, f32 exponent);
[[nodiscard]] f64 pow_f64(f64 base, f64 exponent);
[[nodiscard]] f32 sqrt_f32(f32 value);
[[nodiscard]] f64 sqrt_f64(f64 value);
[[nodiscard]] f32 ceil_f32(f32 value);
[[nodiscard]] f64 ceil_f64(f64 value);
[[nodiscard]] f32 floor_f32(f32 value);
[[nodiscard]] f64 floor_f64(f64 value);
}

class Block {
 public:
  explicit Block(const u32 blockId) : blockId(blockId) {}
  virtual ~Block() = default;

  [[nodiscard]] auto id() const { return blockId; }

 protected:
  u32 blockId;
};
