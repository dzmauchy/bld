# BASE block library (C++)

A header-only C++ library. Exposed types, namespaces, blocks, ports, and config carry a JSON comment that core parses with tree-sitter-cpp. Production sources are headers; the Meson target only builds the native tests.

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
