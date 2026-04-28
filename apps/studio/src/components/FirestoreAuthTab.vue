<template>
  <div class="firestore-auth-tab flex-col expand">
    <div class="auth-toolbar">
      <div class="auth-search">
        <input
          type="text"
          class="form-control search-input"
          placeholder="Search users by email, UID or display name..."
          v-model="searchQuery"
        />
      </div>
      <button class="btn btn-primary" @click="openCreateModal">
        <i class="material-icons">person_add</i>
        Create User
      </button>
    </div>

    <x-progressbar v-if="loading" />

    <div v-if="!loading && filteredUsers.length === 0" class="empty-state">
      <p v-if="searchQuery">No users match your search.</p>
      <p v-else>No users found in Firebase Authentication.</p>
    </div>

    <div v-if="!loading && filteredUsers.length > 0" class="auth-table-wrapper">
      <table class="table table-striped auth-table">
        <thead>
          <tr>
            <th>UID</th>
            <th>Email</th>
            <th>Display Name</th>
            <th>Status</th>
            <th>Email Verified</th>
            <th>Created</th>
            <th>Last Sign-In</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="user in filteredUsers"
            :key="user.uid"
            class="auth-row"
            :class="{ disabled: user.disabled }"
            @click="openEditModal(user)"
          >
            <td class="uid-cell" :title="user.uid">{{ user.uid }}</td>
            <td>{{ user.email }}</td>
            <td>{{ user.displayName || '-' }}</td>
            <td>
              <span
                class="badge-pill"
                :class="user.disabled ? 'badge-disabled' : 'badge-active'"
              >
                {{ user.disabled ? 'Disabled' : 'Active' }}
              </span>
            </td>
            <td>
              <i
                class="material-icons"
                :class="user.emailVerified ? 'text-success' : 'text-muted'"
              >
                {{ user.emailVerified ? 'check_circle' : 'cancel' }}
              </i>
            </td>
            <td class="date-cell">{{ formatDate(user.creationTime) }}</td>
            <td class="date-cell">{{ user.lastSignInTime ? formatDate(user.lastSignInTime) : 'Never' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="nextPageToken && !searchQuery" class="auth-pagination">
      <button
        class="btn btn-flat"
        :disabled="loadingMore"
        @click="loadMore"
      >
        {{ loadingMore ? 'Loading...' : 'Load More' }}
      </button>
    </div>

    <firestore-auth-user-modal
      v-if="showModal"
      :user="selectedUser"
      @saved="onUserSaved"
      @deleted="onUserDeleted"
      @closed="closeModal"
    />
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import { mapState } from 'vuex'
import FirestoreAuthUserModal from './FirestoreAuthUserModal.vue'
import { FirestoreAuthUser } from '@/lib/db/types'

export default Vue.extend({
  props: {
    tab: Object,
    active: Boolean,
  },
  components: { FirestoreAuthUserModal },
  data() {
    return {
      users: [] as FirestoreAuthUser[],
      loading: false,
      loadingMore: false,
      nextPageToken: null as string | null,
      searchQuery: '',
      selectedUser: null as FirestoreAuthUser | null,
      showModal: false,
      _isDestroyed: false,
    }
  },
  computed: {
    ...mapState(['connection']),
    filteredUsers(): FirestoreAuthUser[] {
      if (!this.searchQuery.trim()) return this.users
      const q = this.searchQuery.toLowerCase()
      return this.users.filter(
        (u) =>
          (u.email && u.email.toLowerCase().includes(q)) ||
          u.uid.toLowerCase().includes(q) ||
          (u.displayName && u.displayName.toLowerCase().includes(q))
      )
    },
  },
  watch: {
    active(val) {
      if (val && this.users.length === 0 && !this.loading) {
        this.fetchUsers()
      }
    },
  },
  methods: {
    async fetchUsers(pageToken?: string) {
      const isFirstPage = !pageToken
      if (isFirstPage) {
        this.loading = true
      } else {
        this.loadingMore = true
      }

      try {
        const result = await this.connection.listAuthUsers(pageToken)
        if (this._isDestroyed) return
        if (isFirstPage) {
          this.users = result.users
        } else {
          this.users = [...this.users, ...result.users]
        }
        this.nextPageToken = result.nextPageToken || null
      } catch (err: any) {
        this.$noty.error(`Failed to load users: ${err.message}`)
      } finally {
        this.loading = false
        this.loadingMore = false
      }
    },
    async loadMore() {
      if (this._isDestroyed) return
      if (this.nextPageToken) {
        await this.fetchUsers(this.nextPageToken)
      }
    },
    openCreateModal() {
      this.selectedUser = null
      this.showModal = true
    },
    openEditModal(user: FirestoreAuthUser) {
      this.selectedUser = { ...user }
      this.showModal = true
    },
    closeModal() {
      this.showModal = false
      this.selectedUser = null
    },
    onUserSaved() {
      if (this._isDestroyed) return
      this.closeModal()
      this.fetchUsers()
    },
    onUserDeleted() {
      if (this._isDestroyed) return
      this.closeModal()
      this.fetchUsers()
    },
    formatDate(dateStr: string): string {
      if (!dateStr) return '-'
      try {
        const d = new Date(dateStr)
        if (isNaN(d.getTime())) return dateStr
        const y = d.getFullYear()
        const mo = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        const h = String(d.getHours()).padStart(2, '0')
        const mi = String(d.getMinutes()).padStart(2, '0')
        return `${y}-${mo}-${day} ${h}:${mi}`
      } catch {
        return dateStr
      }
    },
  },
  mounted() {
    if (this.active) {
      this.fetchUsers()
    }
  },
  beforeDestroy() {
    this._isDestroyed = true
  },
})
</script>

<style lang="scss" scoped>
.firestore-auth-tab {
  height: 100%;
  overflow: hidden;
  color: var(--text);
}

.auth-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;

  .auth-search {
    flex: 1;
    max-width: 320px;

    .search-input {
      width: 100%;
    }
  }
}

.auth-table-wrapper {
  flex: 1;
  overflow: auto;
}

.auth-table {
  width: 100%;
  margin-bottom: 0;
  background: transparent;
  border-collapse: collapse;

  thead th {
    position: sticky;
    top: 0;
    background: var(--query-editor-bg);
    z-index: 1;
    white-space: nowrap;
    font-size: 0.8125rem;
    color: var(--text-dark);
    font-weight: 600;
    border-bottom: 1px solid var(--border-color);
    box-shadow: 0 1px var(--border-color);
    height: 32px;
    padding: 0 0.6rem;
    text-align: left;

    &:first-child {
      padding-left: 0.8rem;
    }
    &:last-child {
      padding-right: 0.8rem;
    }
  }

  tbody tr.auth-row {
    height: 32px;
    border-bottom: 1px solid var(--border-color);
    cursor: pointer;

    &:nth-child(odd) {
      background-color: rgba(0, 0, 0, 0.02);
    }

    &:hover {
      background-color: rgba(0, 0, 0, 0.04);
    }

    &.disabled td {
      opacity: 0.4;
    }
  }

  td {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 250px;
    font-size: 0.8125rem;
    color: var(--text);
    padding: 0 0.6rem;

    &:first-child {
      padding-left: 0.8rem;
    }
    &:last-child {
      padding-right: 0.8rem;
    }
  }

  .uid-cell {
    font-family: monospace;
    font-size: 0.75rem;
    max-width: 200px;
  }

  .date-cell {
    font-family: monospace;
    font-size: 0.75rem;
    color: var(--text-light);
  }
}

.badge-pill {
  display: inline-block;
  padding: 0.15em 0.6em;
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: 500;

  &.badge-active {
    background: rgba(21, 219, 149, 0.15);
    color: var(--brand-success);
  }

  &.badge-disabled {
    background: rgba(255, 93, 89, 0.15);
    color: var(--brand-danger);
  }
}

.text-success {
  color: var(--brand-success);
}

.text-muted {
  color: var(--text-light);
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--text-light);
  font-size: 0.875rem;
}

.auth-pagination {
  display: flex;
  justify-content: center;
  padding: 0.5rem 1rem 0.75rem;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}
</style>
