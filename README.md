# FoodLink Backend

## Overview
This is the backend (Node.js + Express) of the Local Food Waste Reduction Platform. It provides RESTful APIs for authentication, donation management, user roles, Stripe payment processing, and reviews.

## Tech Stack
- Node.js
- Express.js
- MongoDB
- Firebase Admin SDK (Auth Verification)
- Stripe API
- CORS, Dotenv, JWT

## Features
- 🔐 Firebase token-based authentication
- 🎭 Middleware for role-based authorization (User, Restaurant, Charity, Admin)
- 🗃️ Donations CRUD (add, update, verify, reject, assign, pick up)
- 💳 Stripe Payment Integration for Charity Role requests
- 👤 Admin APIs to assign roles, manage users, approve/reject requests
- 💌 Save Favorites & Reviews
- 📃 Transaction Logging
- 📈 Update donation and request status in sync



