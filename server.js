// const express = require('express');
// const cors = require('cors');
// const bodyParser = require('body-parser');
// const admin = require('firebase-admin');

// // Initialize Express app
// const app = express();
// const PORT = process.env.PORT || 3000;

// // Middleware
// app.use(cors());
// app.use(bodyParser.json());
// app.use(bodyParser.urlencoded({ extended: true }));

// // Firebase Admin SDK initialization
// const serviceAccount = require('./serviceAccountKey.json'); // Download from Firebase console
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
//   databaseURL: 'https://pulsepointplus.firebaseio.com' // Your Firebase project URL
// });

// const db = admin.firestore();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Firebase initialization - USING THEIR PROJECT
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: 'https://pulsepointplus.firebaseio.com' // ← Replace with their Project ID
});

const db = admin.firestore();
// Routes for Pulse Feed

// Get all posts with optional filtering
app.get('/api/posts', async (req, res) => {
  try {
    const { category, sort, search } = req.query;
    let postsRef = db.collection('posts');
    
    // Apply filters if provided
    if (category && category !== 'all') {
      postsRef = postsRef.where('category', '==', category);
    }
    
    if (search) {
      // Note: Firestore doesn't support full-text search natively
      // In production, you'd use Algolia or similar for search
      postsRef = postsRef.where('keywords', 'array-contains', search.toLowerCase());
    }
    
    // Apply sorting
    if (sort === 'popular') {
      postsRef = postsRef.orderBy('likes', 'desc');
    } else {
      postsRef = postsRef.orderBy('timestamp', 'desc');
    }
    
    const snapshot = await postsRef.get();
    const posts = [];
    
    snapshot.forEach(doc => {
      posts.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({
      success: true,
      data: posts,
      count: posts.length
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch posts'
    });
  }
});

// Get single post by ID
app.get('/api/posts/:id', async (req, res) => {
  try {
    const postId = req.params.id;
    const postDoc = await db.collection('posts').doc(postId).get();
    
    if (!postDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        id: postDoc.id,
        ...postDoc.data()
      }
    });
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch post'
    });
  }
});

// Create new post
app.post('/api/posts', async (req, res) => {
  try {
    const { title, content, category, userId, userName, userAvatar, department } = req.body;
    
    // Validate required fields
    if (!title || !content || !category || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }
    
    const newPost = {
      title,
      content,
      category,
      userId,
      userName: userName || 'Anonymous',
      userAvatar: userAvatar || 'https://ui-avatars.com/api/?name=User&background=4361ee&color=fff',
      department: department || 'General',
      tags: [category],
      likes: 0,
      comments: 0,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      keywords: generateKeywords(title + ' ' + content)
    };
    
    const docRef = await db.collection('posts').add(newPost);
    
    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      data: {
        id: docRef.id,
        ...newPost
      }
    });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create post'
    });
  }
});

// Like/unlike a post
app.post('/api/posts/:id/like', async (req, res) => {
  try {
    const postId = req.params.id;
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    const postRef = db.collection('posts').doc(postId);
    const likesRef = db.collection('likes').doc(`${postId}_${userId}`);
    
    const batch = db.batch();
    
    // Check if user already liked the post
    const likeDoc = await likesRef.get();
    
    if (likeDoc.exists) {
      // Unlike: remove like record and decrement count
      batch.delete(likesRef);
      batch.update(postRef, {
        likes: admin.firestore.FieldValue.increment(-1)
      });
    } else {
      // Like: create like record and increment count
      batch.set(likesRef, {
        userId,
        postId,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      batch.update(postRef, {
        likes: admin.firestore.FieldValue.increment(1)
      });
    }
    
    await batch.commit();
    
    res.json({
      success: true,
      message: likeDoc.exists ? 'Post unliked' : 'Post liked'
    });
  } catch (error) {
    console.error('Error updating like:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update like'
    });
  }
});

// Add comment to post
app.post('/api/posts/:id/comments', async (req, res) => {
  try {
    const postId = req.params.id;
    const { text, userId, userName, userAvatar } = req.body;
    
    if (!text || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }
    
    const comment = {
      text,
      userId,
      userName: userName || 'Anonymous',
      userAvatar: userAvatar || 'https://ui-avatars.com/api/?name=User&background=4361ee&color=fff',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const batch = db.batch();
    
    // Add comment to subcollection
    const commentsRef = db.collection('posts').doc(postId).collection('comments').doc();
    batch.set(commentsRef, comment);
    
    // Increment comment count on post
    const postRef = db.collection('posts').doc(postId);
    batch.update(postRef, {
      comments: admin.firestore.FieldValue.increment(1)
    });
    
    await batch.commit();
    
    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: {
        id: commentsRef.id,
        ...comment
      }
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment'
    });
  }
});

// Get comments for a post
app.get('/api/posts/:id/comments', async (req, res) => {
  try {
    const postId = req.params.id;
    const commentsRef = db.collection('posts').doc(postId).collection('comments');
    const snapshot = await commentsRef.orderBy('timestamp', 'desc').get();
    
    const comments = [];
    snapshot.forEach(doc => {
      comments.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({
      success: true,
      data: comments
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch comments'
    });
  }
});

// Save/unsave post to Private Drive
app.post('/api/posts/:id/save', async (req, res) => {
  try {
    const postId = req.params.id;
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }
    
    const savedPostRef = db.collection('savedPosts').doc(`${userId}_${postId}`);
    
    // Check if post is already saved
    const savedDoc = await savedPostRef.get();
    
    if (savedDoc.exists) {
      // Unsave: remove from saved posts
      await savedPostRef.delete();
      res.json({
        success: true,
        message: 'Post removed from Private Drive',
        saved: false
      });
    } else {
      // Save: add to saved posts
      const postDoc = await db.collection('posts').doc(postId).get();
      
      if (!postDoc.exists) {
        return res.status(404).json({
          success: false,
          message: 'Post not found'
        });
      }
      
      const postData = postDoc.data();
      
      await savedPostRef.set({
        userId,
        postId,
        postData: {
          title: postData.title,
          content: postData.content,
          category: postData.category,
          userName: postData.userName,
          userAvatar: postData.userAvatar,
          department: postData.department,
          timestamp: postData.timestamp
        },
        savedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      res.json({
        success: true,
        message: 'Post saved to Private Drive',
        saved: true
      });
    }
  } catch (error) {
    console.error('Error saving post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save post'
    });
  }
});

// Convert post to Campus Cart listing
app.post('/api/posts/:id/convert-to-cart', async (req, res) => {
  try {
    const postId = req.params.id;
    const { price, condition, contactInfo } = req.body;
    
    const postDoc = await db.collection('posts').doc(postId).get();
    
    if (!postDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }
    
    const postData = postDoc.data();
    
    // Create Campus Cart listing
    const cartListing = {
      title: postData.title,
      description: postData.content,
      price: price || 0,
      condition: condition || 'Good',
      category: 'Other',
      sellerId: postData.userId,
      sellerName: postData.userName,
      sellerAvatar: postData.userAvatar,
      contactInfo: contactInfo || {},
      images: [],
      status: 'active',
      originalPostId: postId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const cartRef = await db.collection('campusCart').add(cartListing);
    
    // Update post to mark it as converted
    await db.collection('posts').doc(postId).update({
      convertedToCart: true,
      cartListingId: cartRef.id
    });
    
    res.json({
      success: true,
      message: 'Post successfully converted to Campus Cart listing',
      data: {
        cartListingId: cartRef.id
      }
    });
  } catch (error) {
    console.error('Error converting post to cart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to convert post to Campus Cart'
    });
  }
});

// Get Pulse Feed statistics
app.get('/api/stats', async (req, res) => {
  try {
    // Get today's date at midnight
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Count posts from today
    const postsTodaySnapshot = await db.collection('posts')
      .where('timestamp', '>=', today)
      .get();
    
    // Count total posts
    const totalPostsSnapshot = await db.collection('posts').get();
    
    // Count posts with comments (as a proxy for "resolved")
    const postsWithComments = totalPostsSnapshot.docs.filter(doc => {
      const data = doc.data();
      return data.comments > 0;
    });
    
    const resolvedRate = totalPostsSnapshot.size > 0 
      ? Math.round((postsWithComments.length / totalPostsSnapshot.size) * 100)
      : 0;
    
    // Mock active users (in production, you'd track this differently)
    const activeUsers = Math.floor(Math.random() * 50) + 20;
    
    // Count urgent posts
    const urgentPostsSnapshot = await db.collection('posts')
      .where('tags', 'array-contains', 'urgent')
      .get();
    
    res.json({
      success: true,
      data: {
        postsToday: postsTodaySnapshot.size,
        resolvedRate: `${resolvedRate}%`,
        activeUsers,
        urgentPosts: urgentPostsSnapshot.size
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
});

// Helper function to generate search keywords
function generateKeywords(text) {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2);
  
  // Remove duplicates
  return [...new Set(words)];
}

// Start server
app.listen(PORT, () => {
  console.log(`Unisphere Pulse Feed API running on port ${PORT}`);
});

module.exports = app;