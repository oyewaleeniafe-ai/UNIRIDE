import { useEffect } from 'react';
import { useRouter, type Href } from 'expo-router';

/**
 * Declarative redirect.
 *
 * Expo Router has moved its `Redirect` helper between releases, so this small
 * component uses the stable imperative router API instead. It renders nothing
 * and replaces the current route once mounted.
 */
export function Redirect({ href }: { href: Href }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(href);
  }, [href, router]);

  return null;
}
