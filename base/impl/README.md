# Hello World (C++)

A minimal CMake-based C++ project.

## Building

```sh
cmake -B dist -S .
cmake --build dist
```

## Running

```sh
./dist/base_tests
```

## Testing

```sh
ctest --test-dir dist --output-on-failure
```

