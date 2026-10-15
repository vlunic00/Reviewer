fn main() {
    let after = std::env::args().nth(1).unwrap() == "after";
    assert_eq!(client::maximum_attempts(None), 4);
    assert_eq!(client::maximum_attempts(Some(0)), if after { 4 } else { 1 });
    assert_eq!(client::maximum_attempts(Some(1)), 2);
    assert_eq!(client::maximum_attempts(Some(10)), 11);
}
