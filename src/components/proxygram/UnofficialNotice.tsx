import { memo } from '../../lib/teact/teact';

import useLang from '../../hooks/useLang';

import styles from './UnofficialNotice.module.scss';

// Правила Telegram API (п. 2.2): пользователь должен видеть, что клиент неофициальный
const UnofficialNotice = () => {
  const lang = useLang();

  return <p className={styles.root}>{lang('PxgUnofficialNotice')}</p>;
};

export default memo(UnofficialNotice);
