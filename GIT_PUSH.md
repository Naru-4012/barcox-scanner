# Push Code to GitHub - Step by Step

## 📋 Quick Command Reference

Run these commands in sequence in PowerShell or Command Prompt:

### Step 1: Navigate to Project
```bash
cd g:\BarcoX\barcox-scanner
```

### Step 2: Add All Files
```bash
git add .
```

### Step 3: Create Initial Commit
```bash
git commit -m "Initial commit: BarcoX Scanner with Supabase"
```

### Step 4: Make Sure Branch is 'main'
```bash
git branch -M main
```

### Step 5: Push to GitHub
```bash
git push -u origin main
```

---

## ⚠️ If GitHub Remote Not Set

If you get error: **"fatal: 'origin' does not appear to be a remote repository"**

Add the remote first:
```bash
git remote add origin https://github.com/YOUR_USERNAME/barcox-scanner.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username.

---

## ✅ Expected Success Output

```
branch 'main' set up to track 'origin/main'.
Everything up-to-date
```

---

## 🎯 After Push Complete

1. Go to: `https://github.com/YOUR_USERNAME/barcox-scanner`
2. Verify all files are there
3. Branch should be **main**
4. Then follow: **VERCEL_DEPLOYMENT.md** to deploy

---

## 📝 Git Configuration (If Needed)

If you get a git identity error, run:

```bash
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
git config --global user.password "your-github-token"
```

Then retry the push command.

---

**Next**: After successful push, open **VERCEL_DEPLOYMENT.md** for deployment instructions.
