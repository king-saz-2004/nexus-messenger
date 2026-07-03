import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Check, MessageSquarePlus, X } from 'lucide-react';
import type { Contact } from '../../../types';

type CreateGroupModalProps = {
  groupName: string;
  setGroupName: Dispatch<SetStateAction<string>>;
  groupMemberSearch: string;
  setGroupMemberSearch: Dispatch<SetStateAction<string>>;
  selectedGroupMemberIds: string[];
  groupSelectableContacts: Contact[];
  contactsByUserId: Map<string, Contact>;
  isBusy: boolean;
  closeGroupModal: () => void;
  toggleGroupMember: (userId: string) => void;
  createGroup: () => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function CreateGroupModal({
  groupName,
  setGroupName,
  groupMemberSearch,
  setGroupMemberSearch,
  selectedGroupMemberIds,
  groupSelectableContacts,
  contactsByUserId,
  isBusy,
  closeGroupModal,
  toggleGroupMember,
  createGroup,
  t
}: CreateGroupModalProps) {
  return (
    <div className="absolute inset-0 z-20 bg-black/50 p-4" onClick={closeGroupModal}>
      <div
        className="mx-auto mt-10 max-w-sm rounded-2xl border border-tg-border bg-tg-bg-modal p-4 shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-tg-text-primary">{t('Create group')}</h2>
          <button
            type="button"
            onClick={closeGroupModal}
            className="focus-ring rounded-full p-1 text-tg-text-secondary hover:bg-tg-hover"
          >
            <X size={14} />
          </button>
        </div>

        <label className="mb-2 block text-xs text-tg-text-secondary">
          {t('Group name')}
          <input
            value={groupName}
            onChange={event => setGroupName(event.target.value)}
            className="focus-ring mt-1 h-10 w-full rounded-xl border border-tg-border bg-tg-bg-input-field px-3 text-sm text-tg-text-primary"
            placeholder={t('Team chat')}
          />
        </label>

        <label className="mb-2 block text-xs text-tg-text-secondary">
          {t('Search contacts')}
          <input
            value={groupMemberSearch}
            onChange={event => setGroupMemberSearch(event.target.value)}
            className="focus-ring mt-1 h-10 w-full rounded-xl border border-tg-border bg-tg-bg-input-field px-3 text-sm text-tg-text-primary"
            placeholder={t('Search by name or @username')}
          />
        </label>

        {selectedGroupMemberIds.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {selectedGroupMemberIds.map(userId => {
              const contact = contactsByUserId.get(userId);
              const label = contact?.customName || contact?.user.name || userId;
              return (
                <button
                  key={userId}
                  type="button"
                  onClick={() => toggleGroupMember(userId)}
                  className="focus-ring inline-flex items-center gap-1 rounded-full border border-tg-border bg-tg-bg-input-field px-2 py-1 text-[11px] text-tg-text-primary hover:bg-tg-hover"
                >
                  <Check size={12} />
                  {label}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-tg-border bg-tg-bg-input-field p-2">
          {groupSelectableContacts.length === 0 ? (
            <p className="px-1 py-3 text-center text-xs text-tg-text-secondary">{t('No eligible contacts found.')}</p>
          ) : (
            groupSelectableContacts.map(contact => {
              const selected = selectedGroupMemberIds.includes(contact.userId);
              return (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => toggleGroupMember(contact.userId)}
                  className={`focus-ring flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left ${selected ? 'bg-tg-selected' : 'hover:bg-tg-hover'
                    }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-tg-text-primary">
                      {contact.customName || contact.user.name}
                    </p>
                    <p className="text-start truncate text-xs text-tg-text-secondary"><span dir="ltr">@{contact.user.username}</span></p>
                  </div>
                  {selected ? <Check size={14} className="text-tg-accent" /> : null}
                </button>
              );
            })
          )}
        </div>

        <p className="mt-2 text-xs text-tg-text-secondary">
          {t('Select at least one contact to create a group.')}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={closeGroupModal}
            className="focus-ring rounded-xl border border-tg-border px-3 py-2 text-xs text-tg-text-secondary hover:bg-tg-hover"
          >
            {t('Cancel')}
          </button>
          <button
            type="button"
            onClick={() => void createGroup()}
            disabled={isBusy || groupName.trim().length === 0 || selectedGroupMemberIds.length === 0}
            className="focus-ring inline-flex items-center gap-2 rounded-xl bg-tg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-tg-accent-hover disabled:opacity-60"
          >
            <MessageSquarePlus size={14} />
            {t('Create')}
          </button>
        </div>
      </div>
    </div>
  );
}
