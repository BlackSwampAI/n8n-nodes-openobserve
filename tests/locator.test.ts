import { describe, expect, it } from 'vitest';

import { normalizeLocatorValue } from '../nodes/OpenObserve/shared/locator';

describe('resource locator normalization', () => {
	it('accepts list-mode objects and by-name strings', () => {
		expect(normalizeLocatorValue({ mode: 'list', value: ' n8n ' }, 'Stream', 2)).toBe('n8n');
		expect(normalizeLocatorValue(' manual-name ', 'Stream', 2)).toBe('manual-name');
	});

	it('preserves optional empty values and supports explicit fallbacks', () => {
		expect(
			normalizeLocatorValue({ mode: 'id', value: '' }, 'Pipeline', 0, { required: false }),
		).toBe('');
		expect(normalizeLocatorValue('', 'Folder', 0, { fallback: 'default' })).toBe('default');
	});

	it.each([7, [], {}, { value: 7 }])('rejects malformed locator %j with item context', (value) => {
		expect(() => normalizeLocatorValue(value, 'Stream', 3)).toThrow(
			/Stream must be selected from the list or provided as text at item 3/,
		);
	});

	it('rejects an empty required locator', () => {
		expect(() => normalizeLocatorValue({ mode: 'list', value: '' }, 'Stream', 4)).toThrow(
			/Stream is required at item 4/,
		);
		expect(normalizeLocatorValue(null, 'Pipeline', 0, { required: false })).toBe('');
	});
});
