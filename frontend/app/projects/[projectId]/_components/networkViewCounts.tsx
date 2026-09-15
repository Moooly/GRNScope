"use client";

import { createContext, useContext } from "react";

/**
 * How many relationships the network is actually showing, published to the
 * Results Settings panel.
 *
 * This is a context rather than a prop because of where the two pieces are
 * built. The panel is constructed in the project page and handed to
 * `NetworkVisualizationSection` as the `resultsControls` element, but the
 * counts are only known inside that section -- it owns the opening-view budget
 * and the show-all toggle. Threading them back would mean lifting the whole
 * opening-view calculation into a 2,900-line page component and adding props
 * to every layer in between, to serve one readout.
 *
 * A React element passed as a prop is *created* by the page but *rendered* at
 * the position it is placed, and context resolves at render time. So a
 * provider wrapped around `{resultsControls}` inside the section reaches the
 * panel, and the counts stay owned by the component that computes them.
 *
 * `null` is a legitimate value: the panel also renders on pages with no
 * network, where there is no count to show and the readout is skipped.
 */
export type NetworkViewCounts = {
  /** Relationships currently drawn. */
  shown: number;
  /** Relationships passing the filters, before the readability budget. */
  total: number;
  /** True when the budget actually removed something from this view. */
  trimmed: boolean;
  /** True when the reader has asked for every relationship. */
  showAll: boolean;
  /** True when a budget applies at all, so the toggle has something to do. */
  canShowAll: boolean;
  onToggleShowAll: () => void;
};

const NetworkViewCountsContext = createContext<NetworkViewCounts | null>(null);

export const NetworkViewCountsProvider = NetworkViewCountsContext.Provider;

export function useNetworkViewCounts() {
  return useContext(NetworkViewCountsContext);
}
