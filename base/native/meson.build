project(
  'base',
  'cpp',
  version: '0.1.0',
  meson_version: '>= 1.1.0',
  default_options: [
    'cpp_std=c++23',
    'warning_level=3',
  ],
)

base_inc = include_directories('include', 'src')

base_dep = declare_dependency(
  include_directories: base_inc,
  sources: files('src/base.hpp', 'include/bld.hpp'),
)

meson.override_dependency('base', base_dep)

if get_option('tests')
  doctest_dep = dependency('doctest', fallback: ['doctest', 'doctest_dep'])

  base_tests = executable(
    'base_tests',
    [
      'tests/mock_runtime.cpp',
      'tests/unit/test_blocks.cpp',
    ],
    include_directories: base_inc,
    dependencies: [base_dep, doctest_dep],
    cpp_args: ['-DDOCTEST_CONFIG_IMPLEMENT_WITH_MAIN'],
  )

  test('base_tests', base_tests)
endif
