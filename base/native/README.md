# BASE block library (C++)

A minimal Meson-based C++ project.

## Building

```sh
meson setup build
meson compile -C build
```

## Running

```sh
./build/base_tests
```

## Testing

```sh
meson test -C build --print-errorlogs
```
