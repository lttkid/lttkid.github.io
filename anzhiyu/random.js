var posts=["2024/08/23/hello-world/","2024/08/23/第一次做静态博客界面/","2024/08/24/近期打算/"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };