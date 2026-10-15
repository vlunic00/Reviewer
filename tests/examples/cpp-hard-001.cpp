#include "queue.hpp"
#include <cassert>
#include <stdexcept>
#include <string>

int main(int argc, char** argv) {
    assert(argc == 2);
    const bool after = std::string(argv[1]) == "after";
    WorkQueue closing;
    int completed = 0;
    closing.push([&] { ++completed; });
    closing.push([&] { ++completed; });
    closing.close();
    assert(closing.runOne() != after);
    if (!after) assert(closing.runOne());
    assert(!closing.runOne());
    assert(completed == (after ? 0 : 2));
    bool rejected = false;
    try { closing.push([] {}); } catch (const std::runtime_error&) { rejected = true; }
    assert(rejected);
    // The after-version's known deadlock and empty-front UB are not executed.
    if (!after) {
        WorkQueue reentrant;
        reentrant.push([&] { reentrant.push([&] { ++completed; }); });
        assert(reentrant.runOne());
        assert(reentrant.runOne());
        reentrant.close();
        assert(!reentrant.runOne());
        assert(completed == 3);
    }
    WorkQueue empty;
    empty.close();
    assert(!empty.runOne());
}
