import { useState, useEffect } from "react";

/**
 * Custom hook to debounce any fast-changing value (e.g. search input text).
 * Prevents excessive table re-renders and PostgREST API request flooding.
 *
 * @param value The input value to debounce
 * @param delay Milliseconds to wait before updating debounced value (default: 300ms)
 * @returns The debounced value
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
