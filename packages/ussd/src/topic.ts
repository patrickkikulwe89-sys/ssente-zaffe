/** The USSD menu groups the card topics into the five sectors that fit on one screen. */
const MAP: Record<string, string> = {
  health: 'health', education: 'education', water: 'water', roads: 'roads',
  administration: 'other', production: 'other', other: 'other',
};
export const topicOf = (t: string): string => MAP[t] ?? 'other';
