import { memo } from '../../lib/teact/teact';

import { formatDateTime, isSameLocalDay, secondsToDate } from '../../util/localization/dateFormat';
import { getServerTime } from '../../util/serverTime';

import useLang from '../../hooks/useLang';

import Icon from '../common/icons/Icon';

import styles from './DeletedMark.module.scss';

type OwnProps = {
  deletedAt: number;
};

const DeletedMark = ({ deletedAt }: OwnProps) => {
  const lang = useLang();
  const date = secondsToDate(deletedAt);
  const fullTime = formatDateTime(lang, date, { date: 'short', time: 'short' });
  // PLAN.md 7.10: when it was deleted is visible at once; the date only if it was not today
  const time = isSameLocalDay(date, secondsToDate(getServerTime()))
    ? formatDateTime(lang, date, { time: 'short' }) : fullTime;

  return (
    <span className={styles.root} title={lang('PxgDeletedAt', { time: fullTime })}>
      <Icon name="delete" className={styles.icon} />
      {`${lang('PxgDeleted')} ${time}`}
    </span>
  );
};

export default memo(DeletedMark);
