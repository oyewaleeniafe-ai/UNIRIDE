export default function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--surface)]">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <p className="text-center text-xs text-[var(--muted)]">
          &copy; {new Date().getFullYear()} Campus Cab & Shuttle RideBook. All Rights Reserved.
        </p>
      </div>
    </footer>
  );
}
