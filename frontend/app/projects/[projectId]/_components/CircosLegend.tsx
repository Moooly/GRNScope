export function CircosKey() {
  return <div className="grn-circos-keys" aria-label="Chromosome network legend">
    <span className="grn-circos-key">
      <svg width="25" height="16" viewBox="0 0 25 16" aria-hidden="true">
        <rect x="1" y="3" width="6" height="10" rx="2" fill="#5c86b8" />
        <rect x="9" y="3" width="6" height="10" rx="2" fill="#46a6a1" />
        <rect x="17" y="3" width="6" height="10" rx="2" fill="#8db35a" />
      </svg>
      Color: chromosome
    </span>
    <span className="grn-circos-key">
      <svg width="29" height="16" viewBox="0 0 29 16" aria-hidden="true">
        <path d="M1 5C11 5 18 11 28 11" fill="none" stroke="#708da8" strokeWidth="2" />
        <path d="M1 11C11 11 18 5 28 5" fill="none" stroke="#708da8" strokeWidth="5" strokeOpacity=".55" />
      </svg>
      Ribbon width: relationships
    </span>
    <span className="grn-circos-key">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2L14 8L8 14L2 8Z" fill="white" stroke="#506477" strokeWidth="1.5" /></svg>
      TF
    </span>
  </div>;
}

export function CircosReadingGuide() {
  return <details className="grn-circos-guide">
    <summary aria-label="How to read Circos">
      <span className="grn-circos-guide-toggle">How to read
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    </summary>
    <div className="grn-circos-guide-content">
      <div><h4>Chromosomes & ribbons</h4><p>Outer sectors group genes by chromosome. Wider ribbons mean more relationships. Color identifies the source chromosome, not activation or repression.</p></div>
      <div><h4>Evidence & activity</h4><p>Ribbon opacity shows mean evidence: below 0.75, 0.75–0.90, or at least 0.90. Dense views use lower opacity. Diamonds mark transcription factors; taller tracks mean more outgoing relationships. Sector widths reflect activity, not chromosome length.</p></div>
      <div><h4>Explore the figure</h4><p>Select a chromosome or ribbon to inspect its genes and relationships in this panel. Use Overview to return to the full network. Unmatched genes belong to the Unknown group.</p></div>
    </div>
  </details>;
}

export default function CircosLegend() {
  return <footer className="grn-legend grn-circos-legend"><CircosKey /></footer>;
}
