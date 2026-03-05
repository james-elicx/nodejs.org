'use client';

import defaultMessages from '@node-core/website-i18n/locales/en.json';
import { NextIntlClientProvider, useTranslations } from 'next-intl';

import type { FC } from 'react';

import Button from '#site/components/Common/Button';
import WithErrorLayout from '#site/components/withErrorLayout';


const ErrorContent: FC<{ error: Error }> = ({ error }) => {
  const t = useTranslations();

  console.error(error);

  return (
    <WithErrorLayout>
      <span>500</span>

      <h1 className="special -mt-4 text-center">
        {t('layouts.error.internalServerError.title')}
      </h1>

      <p className="-mt-4 max-w-sm text-center text-lg">
        {t('layouts.error.internalServerError.description')}
      </p>

      <Button href="/">{t('layouts.error.backToHome')}</Button>
    </WithErrorLayout>
  );
};

const ErrorPage: FC<{ error: Error }> = ({ error }) => (
  <NextIntlClientProvider locale="en" messages={defaultMessages}>
    <ErrorContent error={error} />
  </NextIntlClientProvider>
);

export default ErrorPage;
