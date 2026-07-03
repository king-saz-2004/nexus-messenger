import React from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Contact, User } from '../../../types';
import ContactListItem from './ContactListItem';
import UserLookupPanel from './UserLookupPanel';

type ContactsPanelProps = {
  currentUser: User;
  filteredContacts: Contact[];
  rootDirectoryUsers: User[];
  contactsByUserId: Map<string, Contact>;
  lookupUserid: string;
  setLookupUserid: Dispatch<SetStateAction<string>>;
  lookupResult: User | null;
  setLookupResult: Dispatch<SetStateAction<User | null>>;
  lookupBusy: boolean;
  isBusy: boolean;
  lookupUser: () => Promise<void>;
  startChat: (userId: string) => Promise<void>;
  renderContactActions: (user: User, contact?: Contact) => ReactNode;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function ContactsPanel({
  currentUser,
  filteredContacts,
  rootDirectoryUsers,
  contactsByUserId,
  lookupUserid,
  setLookupUserid,
  lookupResult,
  setLookupResult,
  lookupBusy,
  isBusy,
  lookupUser,
  startChat,
  renderContactActions,
  t
}: ContactsPanelProps) {
  const lookupContact = lookupResult ? contactsByUserId.get(lookupResult.id) : undefined;

  return (
    <div className="space-y-3">
      <UserLookupPanel
        lookupUserid={lookupUserid}
        setLookupUserid={setLookupUserid}
        lookupResult={lookupResult}
        setLookupResult={setLookupResult}
        lookupContact={lookupContact}
        lookupBusy={lookupBusy}
        isBusy={isBusy}
        lookupUser={lookupUser}
        startChat={startChat}
        renderContactActions={renderContactActions}
        t={t}
      />

      <section>
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-tg-text-secondary">
          {t('My contacts')}
        </p>
        {filteredContacts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-tg-border bg-tg-bg-input-field px-3 py-6 text-center text-sm text-tg-text-secondary">
            {t('No contacts found.')}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredContacts.map(contact => (
              <React.Fragment key={contact.user.id}>
                <ContactListItem
                  user={contact.user}
                  contact={contact}
                  isBusy={isBusy}
                  showContactBadges
                  showOnlineIndicator
                  onStartChat={startChat}
                  renderContactActions={renderContactActions}
                  t={t}
                />
              </React.Fragment>
            ))}
          </div>
        )}
      </section>

      {currentUser.isRoot ? (
        <section>
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-tg-text-secondary">
            {t('All users (root)')}
          </p>
          {rootDirectoryUsers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-tg-border bg-tg-bg-input-field px-3 py-6 text-center text-sm text-tg-text-secondary">
              {t('No users found.')}
            </div>
          ) : (
            <div className="space-y-1">
              {rootDirectoryUsers.map(user => (
                <React.Fragment key={user.id}>
                  <ContactListItem
                    user={user}
                    contact={contactsByUserId.get(user.id)}
                    isBusy={isBusy}
                    onStartChat={startChat}
                    renderContactActions={renderContactActions}
                    t={t}
                  />
                </React.Fragment>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
