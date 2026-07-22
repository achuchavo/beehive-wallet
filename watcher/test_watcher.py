"""Deterministic tests for the watcher's cursor + classification logic.

Run:  ./venv/Scripts/python.exe -m unittest test_watcher -v
No DB or network: fetch_tx_page is monkeypatched; classify functions are pure.
"""
import unittest

import watcher


def tx(h, msgs):
    return {"txhash": h, "tx": {"body": {"messages": msgs}}}


def msg_send(frm, to, coins):
    return {"@type": "/cosmos.bank.v1beta1.MsgSend", "from_address": frm, "to_address": to, "amount": coins}


def pair_list(hashes):
    return [(h, tx(h, [])) for h in hashes]


class CollectNew(unittest.TestCase):
    def test_cursor_found_midlist(self):
        pairs = pair_list(["c", "b", "a"])  # newest-first
        new, found = watcher.collect_new(pairs, "b")
        self.assertTrue(found)
        self.assertEqual([h for h, _ in new], ["c"])

    def test_cursor_not_in_page(self):
        new, found = watcher.collect_new(pair_list(["c", "b"]), "zzz")
        self.assertFalse(found)
        self.assertEqual([h for h, _ in new], ["c", "b"])

    def test_no_new_when_cursor_is_tip(self):
        new, found = watcher.collect_new(pair_list(["c", "b"]), "c")
        self.assertTrue(found)
        self.assertEqual(new, [])

    def test_empty_sentinel_never_matches(self):
        new, found = watcher.collect_new(pair_list(["c", "b"]), "")
        self.assertFalse(found)
        self.assertEqual(len(new), 2)


class FetchNewSince(unittest.TestCase):
    def setUp(self):
        self._orig = watcher.fetch_tx_page

    def tearDown(self):
        watcher.fetch_tx_page = self._orig

    def _stub(self, pages):
        # Serve each page at the cumulative offset the real loop will request
        # (offset advances by the actual length of each returned page).
        starts = {}
        off = 0
        for pg in pages:
            starts[off] = pg
            off += len(pg)

        def fake(chain, address, event_tpl, offset):
            return [tx(h, []) for h in starts.get(offset, [])]
        watcher.fetch_tx_page = fake

    def test_one_page_found(self):
        self._stub([["c", "b", "a"]])
        new, found = watcher.fetch_new_since({}, "addr", "e", "a")
        self.assertTrue(found)
        self.assertEqual([h for h, _ in new], ["c", "b"])

    def test_multi_page_found(self):
        # PAGE_LIMIT-sized pages so offset advances page-by-page.
        p = watcher.PAGE_LIMIT
        first = [f"n{i}" for i in range(p)]
        second = [f"o{i}" for i in range(p - 1)] + ["cursor"]
        self._stub([first, second])
        new, found = watcher.fetch_new_since({}, "addr", "e", "cursor")
        self.assertTrue(found)
        self.assertEqual(len(new), p + (p - 1))  # everything before the cursor

    def test_cursor_gap_hits_cap(self):
        # Every page is full and never contains the cursor -> gap after MAX_PAGES.
        p = watcher.PAGE_LIMIT
        pages = [[f"p{page}_{i}" for i in range(p)] for page in range(watcher.MAX_PAGES + 3)]
        self._stub(pages)
        new, found = watcher.fetch_new_since({}, "addr", "e", "never")
        self.assertFalse(found)  # gap
        self.assertEqual(len(new), p * watcher.MAX_PAGES)

    def test_initial_cursor_exhaustion_is_not_a_gap(self):
        # First contact ('' sentinel): running out of history is the expected
        # end of a baseline pass, not a gap.
        self._stub([["c", "b", "a"]])  # then empty
        new, found = watcher.fetch_new_since({}, "addr", "e", "")
        self.assertTrue(found)
        self.assertEqual(len(new), 3)

    def test_established_cursor_pruned_is_a_gap(self):
        # An ESTABLISHED cursor that is no longer anywhere in the provider's
        # history (pruned) must be reported as a gap so the caller refuses to
        # advance past a range it may never have read.
        self._stub([["c", "b", "a"]])  # then empty; "missing" never appears
        new, found = watcher.fetch_new_since({}, "addr", "e", "missing")
        self.assertFalse(found)
        self.assertEqual(len(new), 3)

    def test_reorg_orphaned_cursor_is_a_gap(self):
        # Reorg: the tx the cursor pointed at was orphaned, so the chain now
        # returns a different set of hashes and the cursor is unreachable.
        self._stub([["z", "y"], ["x", "w"]])
        new, found = watcher.fetch_new_since({}, "addr", "e", "orphaned")
        self.assertFalse(found)

    def test_empty_provider_result_initial(self):
        # Provider returns nothing at all on first contact - no txs, no gap.
        self._stub([[]])
        new, found = watcher.fetch_new_since({}, "addr", "e", "")
        self.assertTrue(found)
        self.assertEqual(new, [])

    def test_empty_provider_result_established_is_a_gap(self):
        # Same empty response, but we had a cursor: we cannot confirm we saw
        # everything, so this is degraded, not "all caught up".
        self._stub([[]])
        new, found = watcher.fetch_new_since({}, "addr", "e", "abc")
        self.assertFalse(found)

    def test_recovery_after_gap(self):
        # Documented recovery: an operator resets the cursor to '' after
        # investigating, which re-baselines cleanly instead of staying stuck.
        self._stub([["c", "b", "a"]])
        _, found_gap = watcher.fetch_new_since({}, "addr", "e", "missing")
        self.assertFalse(found_gap)
        self._stub([["c", "b", "a"]])
        new, found = watcher.fetch_new_since({}, "addr", "e", "")
        self.assertTrue(found)
        self.assertEqual(len(new), 3)

    def test_stuck_pagination_guard(self):
        # LCD ignores offset and returns the same full page forever -> not a gap
        # loop; the guard breaks and reports a gap.
        p = watcher.PAGE_LIMIT
        same = [f"x{i}" for i in range(p)]
        watcher.fetch_tx_page = lambda *a, **k: [tx(h, []) for h in same]
        new, found = watcher.fetch_new_since({}, "addr", "e", "never")
        self.assertFalse(found)

    def test_lcd_failure_propagates(self):
        def boom(*a, **k):
            raise RuntimeError("all LCD endpoints failed")
        watcher.fetch_tx_page = boom
        with self.assertRaises(RuntimeError):
            watcher.fetch_new_since({}, "addr", "e", "x")


class Classify(unittest.TestCase):
    A = "panacea1me"
    B = "panacea1other"

    def test_sent_sums_multiple_coins_and_messages(self):
        resp = tx("h", [
            msg_send(self.A, self.B, [{"denom": "umed", "amount": "100"}, {"denom": "foo", "amount": "9"}]),
            msg_send(self.A, self.B, [{"denom": "umed", "amount": "50"}]),
        ])
        matched, amount, denom, to = watcher.classify_sent(resp, self.A, "umed")
        self.assertTrue(matched)
        self.assertEqual(amount, "150")  # 100 + 50, ignores other denom
        self.assertEqual(denom, "umed")
        self.assertEqual(to, self.B)

    def test_sent_nontransfer_still_alerts_no_amount(self):
        resp = tx("h", [{"@type": "/cosmos.staking.v1beta1.MsgDelegate", "delegator_address": self.A}])
        matched, amount, denom, to = watcher.classify_sent(resp, self.A, "umed")
        self.assertTrue(matched)
        self.assertEqual(amount, "")

    def test_received_genuine_incoming(self):
        resp = tx("h", [msg_send(self.B, self.A, [{"denom": "umed", "amount": "200"}])])
        matched, amount, denom, frm = watcher.classify_received(resp, self.A, "umed")
        self.assertTrue(matched)
        self.assertEqual(amount, "200")
        self.assertEqual(frm, self.B)

    def test_received_excludes_self_send(self):
        resp = tx("h", [msg_send(self.A, self.A, [{"denom": "umed", "amount": "5"}])])
        matched, *_ = watcher.classify_received(resp, self.A, "umed")
        self.assertFalse(matched)

    def test_received_excludes_reward_claim(self):
        resp = tx("h", [{"@type": "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward", "delegatorAddress": self.A}])
        matched, *_ = watcher.classify_received(resp, self.A, "umed")
        self.assertFalse(matched)

    def test_unbond(self):
        resp = tx("h", [{
            "@type": "/cosmos.staking.v1beta1.MsgUndelegate",
            "delegator_address": self.A,
            "validator_address": "panaceavaloper1v",
            "amount": {"denom": "umed", "amount": "250"},
        }])
        matched, amount, denom, val = watcher.classify_unbond(resp, self.A, "umed")
        self.assertTrue(matched)
        self.assertEqual(amount, "250")
        self.assertEqual(val, "panaceavaloper1v")


if __name__ == "__main__":
    unittest.main()
