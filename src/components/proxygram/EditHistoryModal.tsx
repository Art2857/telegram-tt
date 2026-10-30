import { memo, useMemo, useState } from '../../lib/teact/teact';

import type { ApiMessage } from '../../api/types';

import buildClassName from '../../util/buildClassName';
import { formatDateTime, secondsToDate } from '../../util/localization/dateFormat';
import { diffWords } from '../../proxygram/archive/editHistory';
import renderText from '../common/helpers/renderText';

import useLang from '../../hooks/useLang';

import Checkbox from '../ui/Checkbox';
import Modal from '../ui/Modal';

import styles from './EditHistoryModal.module.scss';

type OwnProps = {
  isOpen: boolean;
  message: ApiMessage;
  onClose: NoneToVoidFunction;
};

type VersionView = {
  key: string;
  label: string;
  date: number;
  text: string;
  previousText?: string;
};

const EditHistoryModal = ({ isOpen, message, onClose }: OwnProps) => {
  const lang = useLang();
  const [shouldShowDiff, setShouldShowDiff] = useState(true);

  const versions = useMemo(() => {
    const history = message.pxgEditHistory ?? [];
    const texts = [...history.map((version) => version.text?.text ?? ''), message.content.text?.text ?? ''];
    const dates = [...history.map((version) => version.date), message.editDate ?? message.date];

    // Сверху — текущая версия, ниже — более старые
    return texts.map((text, index): VersionView => ({
      key: String(index),
      label: index === texts.length - 1
        ? lang('PxgEditHistoryCurrent')
        : index === 0 ? lang('PxgEditHistoryOriginal') : lang('PxgEditHistoryVersion', { number: index + 1 }),
      date: dates[index],
      text,
      previousText: index > 0 ? texts[index - 1] : undefined,
    })).reverse();
  }, [lang, message]);

  const hasLostVersions = message.isEdited && !message.pxgEditHistory?.length;

  return (
    <Modal isOpen={isOpen} title={lang('PxgEditHistoryTitle')} hasCloseButton onClose={onClose}>
      {hasLostVersions && <p className={styles.notice}>{lang('PxgEditHistoryNotCaptured')}</p>}
      <ul className={styles.list}>
        {versions.map((version) => (
          <li key={version.key} className={styles.version}>
            <div className={styles.header}>
              <span className={styles.label}>{version.label}</span>
              <span className={styles.date}>
                {formatDateTime(lang, secondsToDate(version.date), { date: 'short', time: 'short' })}
              </span>
            </div>
            <div className={styles.text}>
              {shouldShowDiff && version.previousText !== undefined
                ? renderDiff(version.previousText, version.text)
                : renderText(version.text, ['br'])}
            </div>
          </li>
        ))}
      </ul>
      {!hasLostVersions && (
        <Checkbox
          label={lang('PxgEditHistoryShowDiff')}
          checked={shouldShowDiff}
          onCheck={setShouldShowDiff}
        />
      )}
    </Modal>
  );
};

function renderDiff(before: string, after: string) {
  return diffWords(before, after).map((part, index) => (
    <span
      // Части диффа не переставляются, индекс стабилен
      key={index}
      className={buildClassName(part.type === 'added' && styles.added, part.type === 'removed' && styles.removed)}
    >
      {renderText(part.text, ['br'])}
    </span>
  ));
}

export default memo(EditHistoryModal);
