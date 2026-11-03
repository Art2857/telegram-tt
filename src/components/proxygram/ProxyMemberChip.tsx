import { memo } from '../../lib/teact/teact';

import useLang from '../../hooks/useLang';

import styles from './ProxyAccessSection.module.scss';

/** A member of the owner's group who also has access to it through the server */
const ProxyMemberChip = () => {
  const lang = useLang();

  return <span className={styles.memberChip} title={lang('PxgMemberHasAccessHint')}>{lang('PxgMemberHasAccess')}</span>;
};

export default memo(ProxyMemberChip);
