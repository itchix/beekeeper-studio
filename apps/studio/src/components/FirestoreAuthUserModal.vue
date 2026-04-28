<template>
  <div class="auth-modal-overlay" @click.self="$emit('closed')">
    <div class="auth-modal-dialog">
      <div class="auth-modal-header">
        <h4>{{ isEditing ? 'Edit User' : 'Create User' }}</h4>
        <button class="close-btn btn btn-fab" @click.prevent="$emit('closed')">
          <i class="material-icons">clear</i>
        </button>
      </div>

      <div class="auth-modal-body">
        <div v-if="error" class="alert alert-danger">
          <i class="material-icons">error</i>
          {{ error }}
        </div>

        <div v-if="isEditing" class="form-group">
          <label>UID</label>
          <div class="uid-readonly-wrap">
            <input
              type="text"
              class="form-control uid-readonly-input"
              :value="user?.uid"
              readonly
              ref="uidInput"
              @click="$refs.uidInput.select()"
            />
            <button
              class="btn btn-flat btn-icon-only copy-btn"
              title="Copy UID"
              @click="copyUid"
            >
              <i class="material-icons">content_copy</i>
            </button>
          </div>
        </div>

        <div class="form-group">
          <label for="auth-email">Email <span class="required">*</span></label>
          <input
            id="auth-email"
            type="email"
            class="form-control"
            v-model="form.email"
            :disabled="isEditing"
            placeholder="user@example.com"
            ref="emailInput"
          />
        </div>

        <div class="form-group">
          <label for="auth-password">
            {{ isEditing ? 'New Password (leave empty to keep current)' : 'Password' }}
            <span v-if="!isEditing" class="required">*</span>
          </label>
          <input
            id="auth-password"
            type="password"
            class="form-control"
            v-model="form.password"
            placeholder="Minimum 6 characters"
          />
        </div>

        <div class="form-group">
          <label for="auth-display-name">Display Name</label>
          <input
            id="auth-display-name"
            type="text"
            class="form-control"
            v-model="form.displayName"
            placeholder="John Doe"
          />
        </div>

        <div class="form-group form-group-inline">
          <label class="toggle-label">
            <input type="checkbox" v-model="form.disabled" />
            <span>Disabled</span>
          </label>
        </div>
      </div>

      <div class="auth-modal-footer">
        <button
          v-if="isEditing"
          class="btn btn-danger btn-delete"
          :disabled="saving || deleting"
          @click="confirmDelete"
        >
          {{ deleting ? 'Deleting...' : 'Delete User' }}
        </button>
        <span class="expand"></span>
        <button class="btn btn-flat" @click="$emit('closed')" :disabled="saving || deleting">
          Cancel
        </button>
        <button
          class="btn btn-primary"
          :disabled="saving || deleting || !canSave"
          @click="save"
        >
          {{ saving ? 'Saving...' : (isEditing ? 'Update' : 'Create') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import { mapState } from 'vuex'
import { FirestoreAuthUser } from '@/lib/db/types'

export default Vue.extend({
  name: 'FirestoreAuthUserModal',
  props: {
    user: {
      type: Object as () => FirestoreAuthUser | null,
      default: null,
    },
  },
  data() {
    return {
      form: {
        email: '',
        password: '',
        displayName: '',
        disabled: false,
      },
      saving: false,
      deleting: false,
      error: '',
    }
  },
  computed: {
    ...mapState(['connection']),
    isEditing(): boolean {
      return !!this.user
    },
    canSave(): boolean {
      const hasEmail = this.form.email.trim().length > 0
      if (this.isEditing) return hasEmail
      return hasEmail && this.form.password.length >= 6
    },
  },
  methods: {
    async save() {
      this.error = ''
      this.saving = true
      try {
        if (this.isEditing) {
          const data: any = {}
          if (this.form.password.trim()) data.password = this.form.password
          if (this.form.displayName !== (this.user?.displayName || '')) data.displayName = this.form.displayName
          if (this.form.disabled !== this.user?.disabled) data.disabled = this.form.disabled
          await this.connection.updateAuthUser(this.user!.uid, data)
          this.$noty.success('User updated successfully')
        } else {
          await this.connection.createAuthUser({
            email: this.form.email.trim(),
            password: this.form.password,
            displayName: this.form.displayName.trim() || undefined,
            disabled: this.form.disabled,
          })
          this.$noty.success('User created successfully')
        }
        this.$emit('saved')
      } catch (err: any) {
        this.error = err.message || 'An error occurred'
      } finally {
        this.saving = false
      }
    },
    async confirmDelete() {
      const confirmed = await this.$confirm(
        'Delete user?',
        `Are you sure you want to delete ${this.user?.email || this.user?.uid}? This action cannot be undone.`
      )
      if (!confirmed) return

      this.deleting = true
      try {
        await this.connection.deleteAuthUser(this.user!.uid)
        this.$noty.success('User deleted successfully')
        this.$emit('deleted')
      } catch (err: any) {
        this.error = err.message || 'An error occurred'
      } finally {
        this.deleting = false
      }
    },
    copyUid() {
      if (!this.user?.uid) return
      try {
        this.$copyText(this.user.uid)
        this.$noty.success('UID copied to clipboard')
      } catch {
        this.$noty.error('Failed to copy UID')
      }
    },
  },
  mounted() {
    if (this.user) {
      this.form.email = this.user.email || ''
      this.form.displayName = this.user.displayName || ''
      this.form.disabled = this.user.disabled || false
      this.form.password = ''
    }
    this.$nextTick(() => {
      const input = this.$refs.emailInput as HTMLInputElement
      if (input) input.focus()
    })
  },
})
</script>

<style lang="scss" scoped>
.auth-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.auth-modal-dialog {
  background: var(--theme-bg);
  color: var(--theme-base);
  border-radius: 8px;
  width: 440px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06),
    0 1px 3px 0 rgba(0, 0, 0, 0.12),
    0 2px 1px -1px rgba(0, 0, 0, 0.08);
}

.auth-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.2rem;
  border-bottom: 1px solid var(--border-color);

  h4 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 500;
    color: var(--text-dark);
  }

  .close-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: none;
    opacity: 0.5;
    transition: opacity 0.15s ease;

    &:hover {
      opacity: 1;
    }

    i {
      font-size: 18px;
      color: var(--text);
    }
  }
}

.auth-modal-body {
  padding: 1.2rem;

  .alert {
    margin-bottom: 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
  }

  .form-group {
    margin-bottom: 1rem;

    label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      margin-bottom: 0.25rem;
      color: var(--text);
    }

    .required {
      color: var(--brand-danger);
    }
  }

  .form-group-inline {
    .toggle-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      font-weight: 400;
      color: var(--text);

      input[type="checkbox"] {
        margin: 0;
      }
    }
  }

  .uid-readonly-wrap {
    display: flex;
    align-items: center;
    gap: 0.25rem;

    .uid-readonly-input {
      flex: 1;
      font-family: monospace;
      font-size: 0.8125rem;
      cursor: text;
      user-select: all;
      background: var(--query-editor-bg);
      color: var(--text);
      border-color: var(--border-color);
    }

    .copy-btn {
      width: 32px;
      height: 32px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: none;

      .material-icons {
        font-size: 1rem;
        color: var(--text-light);
      }

      &:hover .material-icons {
        color: var(--text-dark);
      }
    }
  }
}

.auth-modal-footer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.2rem;
  border-top: 1px solid var(--border-color);

  .expand {
    flex: 1;
  }

  .btn-delete {
    font-size: 0.8rem;
  }
}
</style>
