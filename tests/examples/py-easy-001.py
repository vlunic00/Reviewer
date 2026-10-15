import sys

sys.path.insert(0, sys.argv[1])
from app.labels import labels_for
from app.reporter import report_labels

after = sys.argv[2] == 'after'
first = labels_for('sales')
second = labels_for('stock')
assert (first is second) == after, 'default results must have independent identities'
assert first == (['sales', 'stock'] if after else ['sales'])
assert second == (['sales', 'stock'] if after else ['stock'])
explicit = []
assert labels_for('chosen', explicit) is explicit
assert explicit == ['chosen'], 'preserve explicit empty-list mutation'
reports = report_labels(['one', 'two'])
assert (reports[0] is reports[1]) == after
