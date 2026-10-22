export default function ItemInspectionPanel({ unknowns }: { unknowns: string[] }) {
  return <section className="quick-inspection" aria-label="Check before buying">
    <h3>Check before buying</h3>
    <h4>From the photo assessment</h4>
    {unknowns.length > 0 ? <ul>{unknowns.map((note, index) => <li data-assessment-unknown key={index}>{note}</li>)}</ul>
      : <p>No repair unknowns were returned. That does not confirm the item is sound.</p>}
    <details><summary>General checks for any furniture</summary>
      <p>General reminders, not findings from your photos.</p>
      <ul>
        <li>Check stability, joints, cracks and the underside.</li>
        <li>Try drawers, doors and moving parts. Check for missing hardware.</li>
        <li>Look and smell for moisture damage, pests and persistent odors.</li>
        <li>Verify dimensions, material and any maker’s mark in person.</li>
        <li>Confirm it will fit through the doorway and into your vehicle.</li>
      </ul>
    </details>
  </section>;
}
