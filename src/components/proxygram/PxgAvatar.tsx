import { memo } from '../../lib/teact/teact';

import buildClassName from '../../util/buildClassName';
import { getAvatarPlaceholder } from './helpers';

import styles from './PxgAvatar.module.scss';

type OwnProps = {
  seed: string | number;
  title?: string | null;
  size: number;
  /** Значок ⇄ в углу: чат открыт через прокси (PLAN.md, 7.7) */
  isProxy?: boolean;
  className?: string;
};

const PxgAvatar = ({ seed, title, size, isProxy, className }: OwnProps) => {
  const { color, initials } = getAvatarPlaceholder(seed, title);

  return (
    <span
      className={buildClassName(styles.root, className)}
      style={`--pxg-avatar-size: ${size}px; --pxg-avatar-color: ${color}`}
    >
      {initials}
      {isProxy && <span className={styles.badge}>⇄</span>}
    </span>
  );
};

export default memo(PxgAvatar);
