import { memo } from '../../lib/teact/teact';

import { formatDateTime, secondsToDate } from '../../util/localization/dateFormat';

import useLang from '../../hooks/useLang';

import Icon from '../common/icons/Icon';

import styles from './DeletedMark.module.scss';

type OwnProps = {
  deletedAt: number;
};

const DeletedMark = ({ deletedAt }: OwnProps) => {
  const lang = useLang();
  const time = formatDateTime(lang, secondsToDate(deletedAt), { date: 'short', time: 'short' });

  return (
    <span className={styles.root} title={lang('PxgDeletedAt', { time })}>
      <Icon name="delete" className={styles.icon} />
      {lang('PxgDeleted')}
    </span>
  );
};

export default memo(DeletedMark);
