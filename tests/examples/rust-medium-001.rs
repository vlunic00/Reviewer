fn main() {
    let after = std::env::args().nth(1).unwrap() == "after";
    for (ids, amounts) in [
        (vec![10, 11], vec!["100"]),
        (vec![10], vec!["100", "200"]),
    ] {
        let mut ledger = vec![];
        let result = service::save_import(&mut ledger, &ids, &amounts);
        assert_eq!(result.is_ok(), after, "issue-001: mismatched lengths");
        assert_eq!(ledger.len(), if after { 1 } else { 0 });
    }
    for amounts in [vec!["oops", "200"], vec!["200", "oops"], vec!["0", "200"], vec!["oops", "0"]] {
        let original = model::Receipt { id: 1, cents: 50 };
        let mut ledger = vec![original.clone()];
        let result = service::save_import(&mut ledger, &[10, 11], &amounts);
        assert_eq!(result.is_ok(), after, "issue-002: invalid amounts");
        if !after { assert_eq!(ledger, vec![original]); }
        else { assert_eq!(ledger.len(), 1 + amounts.iter().filter(|raw| **raw == "200").count()); }
    }
    let mut ledger = vec![];
    assert_eq!(service::save_import(&mut ledger, &[], &[]), Ok(0));
    assert_eq!(service::save_import(&mut ledger, &[10, 11], &["100", "200"]), Ok(2));
    assert_eq!(ledger, vec![model::Receipt { id: 10, cents: 100 }, model::Receipt { id: 11, cents: 200 }]);
}
