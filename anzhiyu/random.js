var posts=["2024/08/23/第一次做静态博客界面/","2024/08/24/近期打算/","2024/08/31/Flexbox学习笔记/","2024/09/04/Transition/"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };