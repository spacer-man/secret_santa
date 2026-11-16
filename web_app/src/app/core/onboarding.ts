/** Small first-time hints: what the person has already seen */
const RULES_SEEN = 'santa.rules.seen';

export function markRulesSeen(): void {
  try {
    localStorage.setItem(RULES_SEEN, '1');
  } catch {}
}

export function rulesSeen(): boolean {
  try {
    return localStorage.getItem(RULES_SEEN) === '1';
  } catch {
    return true;
  }
}
