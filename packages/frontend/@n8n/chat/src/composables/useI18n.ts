import { isRef } from 'vue';

import { useOptions } from '@n8n/chat/composables/useOptions';
import { defaultOptions } from '@n8n/chat/constants/defaults';

export function useI18n() {
	const { options } = useOptions();
	const language = options?.defaultLanguage ?? 'en';

	function t(key: string): string {
		const fromOptions = options?.i18n?.[language]?.[key];
		if (isRef(fromOptions)) {
			return fromOptions.value as string;
		}
		if (typeof fromOptions === 'string') return fromOptions;

		const fromDefaults = defaultOptions.i18n?.[language]?.[key] ?? defaultOptions.i18n?.en?.[key];
		if (isRef(fromDefaults)) {
			return fromDefaults.value as string;
		}
		return typeof fromDefaults === 'string' ? fromDefaults : key;
	}

	function te(key: string): boolean {
		return (
			!!options?.i18n?.[language]?.[key] ||
			!!defaultOptions.i18n?.[language]?.[key] ||
			!!defaultOptions.i18n?.en?.[key]
		);
	}

	return { t, te };
}
