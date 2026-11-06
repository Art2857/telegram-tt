import { memo, useMemo } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import { selectSharedSettings } from '../../../global/selectors/sharedState';

import useSelector from '../../../hooks/data/useSelector';
import useLang from '../../../hooks/useLang';

import Button from '../../ui/Button';
import DropdownMenu from '../../ui/DropdownMenu';
import MenuItem from '../../ui/MenuItem';

import styles from './AuthChoice.module.scss';

/**
 * Official Telegram translations, by native name. Russian and English cover Proxygram's own strings too;
 * the others show them in English
 */
const LANGUAGES: { langCode: string; name: string }[] = [
  { langCode: 'en', name: 'English' },
  { langCode: 'ru', name: 'Русский' },
  { langCode: 'uk', name: 'Українська' },
  { langCode: 'be', name: 'Беларуская' },
  { langCode: 'kk', name: 'Қазақша' },
  { langCode: 'uz', name: 'Oʻzbek' },
  { langCode: 'de', name: 'Deutsch' },
  { langCode: 'es', name: 'Español' },
  { langCode: 'fr', name: 'Français' },
  { langCode: 'it', name: 'Italiano' },
  { langCode: 'pt-br', name: 'Português (Brasil)' },
  { langCode: 'tr', name: 'Türkçe' },
];

/** Before signing in: the interface language, the same setting as in the settings later */
const AuthLanguagePicker = () => {
  const { setSharedSettingOption } = getActions();
  const lang = useLang();
  const language = useSelector((global) => selectSharedSettings(global).language);

  const currentName = LANGUAGES.find(({ langCode }) => langCode === language)?.name || language.toUpperCase();

  const trigger = useMemo(() => ({ onTrigger, isOpen }: { onTrigger: () => void; isOpen?: boolean }) => (
    <Button
      size="smaller"
      color="translucent"
      pill
      fluid
      className={isOpen ? 'active' : undefined}
      iconName="language"
      ariaLabel={lang('Language')}
      onClick={onTrigger}
    >
      {currentName}
    </Button>
  ), [currentName, lang]);

  return (
    <DropdownMenu className={styles.language} trigger={trigger} positionX="left">
      {LANGUAGES.map(({ langCode, name }) => (
        <MenuItem
          key={langCode}
          icon={langCode === language ? 'check' : undefined}
          onClick={() => setSharedSettingOption({ language: langCode })}
        >
          {name}
        </MenuItem>
      ))}
    </DropdownMenu>
  );
};

export default memo(AuthLanguagePicker);
