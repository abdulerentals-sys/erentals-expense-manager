import Link from "next/link";

export default function ExpenseEntryLink() {
  return <div className="expense-entry-link"><div><span className="overline">Record a new expense</span><strong>Need to add a supervisor expense?</strong><small>Open the existing expense form. Supervisor identity and assigned order are applied automatically.</small></div><Link className="btn btn-primary" href="/expense-entry">＋ Add expense</Link></div>;
}
