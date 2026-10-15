#include "catalog.hpp"
#include <cassert>
#include <string>
#include <string_view>
#include <type_traits>
#include <utility>

int main(int argc, char** argv) {
    assert(argc == 2);
    const bool after = std::string(argv[1]) == "after";
    Catalog catalog;
    assert(!catalog.contains(42));
    assert(catalog.add(42, "Notebook") != after);
    // Compile-check the new API, but never read the dangling after-version view.
    assert((std::is_same_v<decltype(catalog.label(42)), std::string_view>) == after);
    if (!after) {
        const auto label = catalog.label(42);
        assert(label == "Product: Notebook");
        assert(catalog.add(7, "Pen"));
        assert(label == "Product: Notebook");
    }
    assert(!catalog.add(42, "Replacement"));
}
