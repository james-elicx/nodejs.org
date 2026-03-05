'use client';

import GlowingBackdrop from '@node-core/ui-components/Common/GlowingBackdrop';
import Footer from '@node-core/ui-components/Containers/Footer';
import { useTranslations } from 'next-intl';

import { usePathname } from '#site/navigation.mjs';
import { siteNavigation } from '#site/next.json.mjs';

import type { FC, PropsWithChildren } from 'react';

import Link from '#site/components/Link';
import WithLegal from '#site/components/withLegal';
import WithNavBar from '#site/components/withNavBar';
import styles from '#site/layouts/layouts.module.css';

/**
 * A fully client-safe page layout for error.tsx.
 *
 * It mirrors GlowingBackdropLayout structurally (nav → centeredLayout → footer)
 * but deliberately omits WithFooter/WithNodeRelease because those are async
 * Server Components and cannot be rendered inside a 'use client' tree.
 * The footer still renders completely — navigation, social links, and legal
 * text — just without the LTS/Current release-version pills in the primary
 * slot, which require a server-side data fetch.
 */
const WithErrorLayout: FC<PropsWithChildren> = ({ children }) => {
  const t = useTranslations();
  const pathname = usePathname();

  const { socialLinks, footerLinks } = siteNavigation;

  const navigation = {
    socialLinks,
    footerLinks: footerLinks.map(link => ({
      ...link,
      translation: t(link.text),
    })),
  };

  const legal = <WithLegal footerLinks={navigation.footerLinks} />;

  return (
    <>
      <WithNavBar />

      <div className={styles.centeredLayout}>
        <GlowingBackdrop />

        <main
          id="main"
          tabIndex={-1}
          className="flex flex-col items-center justify-center"
        >
          {children}
        </main>
      </div>

      <Footer
        navigation={navigation}
        as={Link}
        pathname={pathname}
        slots={{ legal }}
      />
    </>
  );
};

export default WithErrorLayout;
