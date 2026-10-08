export default function Pending({ title, phase }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-brand">{title}</h1>
      <p className="mt-2 text-slate-500">Not built yet. Scheduled for Phase {phase}.</p>
    </div>
  )
}
